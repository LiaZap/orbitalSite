/* Orbital — servidor único: serve o site, recebe o lead, fala com a Conversions
   API da Meta e serve o painel. Um container só no EasyPanel. */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const capi = require('./meta-capi');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

/* Só estas chaves vão para o browser. metaCapiToken e forwardWebhook nunca saem daqui. */
const PUBLIC_KEYS = ['metaPixelId', 'googleTagId', 'googleLeadLabel', 'attributionDays'];
const ALL_KEYS = [...PUBLIC_KEYS, 'metaTestEventCode', 'metaCapiToken', 'forwardWebhook'];
const SECRET_KEYS = ['metaCapiToken'];

const app = express();
app.set('trust proxy', true);          // EasyPanel/Traefik na frente
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

/* ============ helpers ============ */

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '';
}

/* ponytail: limite em memória, por processo — zera no restart e não vale entre
   réplicas. Suficiente para uma landing; trocar por Redis se escalar horizontal. */
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = clientIp(req);
  const entry = hits.get(key);
  if (!entry || now > entry.reset) hits.set(key, { count: 1, reset: now + 60000 });
  else if (++entry.count > 20) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  if (hits.size > 5000) hits.clear();
  next();
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

function auth(req, res, next) {
  const expected = process.env.PANEL_PASSWORD;
  if (!expected) return res.status(503).send('Defina PANEL_PASSWORD nas variáveis de ambiente.');
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    if (crypto.timingSafeEqual(digest(pass), digest(expected))) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Painel Orbital"').status(401).send('Acesso restrito.');
}

/* ============ site ============ */

let configCache = null;

/* Precisa vir antes do static de /src para sobrescrever o arquivo em disco. */
app.get('/src/tracking-config.js', async (req, res) => {
  try {
    if (!configCache) {
      const settings = await db.getSettings();
      const publicConfig = { leadWebhook: '/api/lead' };
      PUBLIC_KEYS.forEach((k) => { publicConfig[k] = settings[k] || ''; });
      publicConfig.attributionDays = Number(settings.attributionDays) || 90;
      configCache = 'window.ORBITAL_TRACKING = ' + JSON.stringify(publicConfig, null, 2) + ';\n';
    }
    res.type('application/javascript').set('Cache-Control', 'public, max-age=60').send(configCache);
  } catch (err) {
    res.type('application/javascript').send('window.ORBITAL_TRACKING = { leadWebhook: "/api/lead" };\n');
  }
});

app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use('/src', express.static(path.join(ROOT, 'src')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));

/* Arquivos de raiz para buscadores e crawlers de IA. Lista explícita porque um
   express.static(ROOT) entregaria também server/, package.json e .env. */
['robots.txt', 'sitemap.xml', 'llms.txt'].forEach((file) => {
  app.get('/' + file, (req, res) => res.sendFile(path.join(ROOT, file)));
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ============ captação do lead ============ */

app.options('/api/lead', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }).sendStatus(204);
});

app.post('/api/lead', rateLimit, async (req, res) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');

  const body = req.body || {};
  const incoming = body.lead || {};
  const nome = clean(incoming.nome, 120);
  if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });

  /* cortar a string JSON quebraria o cast para jsonb — descarta inteiro se vier gigante */
  const attribution = (body.attribution && typeof body.attribution === 'object') ? body.attribution : {};
  let attributionJson = JSON.stringify(attribution);
  if (attributionJson.length > 8000) attributionJson = '{"truncado":true}';

  const record = {
    nome,
    empresa: clean(incoming.empresa, 120),
    telefone: clean(incoming.telefone, 40),
    segmento: clean(incoming.segmento, 80),
    faturamento: clean(incoming.faturamento, 80),
    objetivo: clean(incoming.objetivo, 120),
    event_id: clean(body.event_id, 100) || crypto.randomUUID(),
    event_time: Number(body.event_time) || Math.floor(Date.now() / 1000),
    event_source_url: clean(body.event_source_url, 500),
    attribution: attributionJson,
    fbp: clean(body.meta && body.meta.fbp, 200),
    fbc: clean(body.meta && body.meta.fbc, 300),
    user_agent: clean(body.client && body.client.user_agent, 400),
    ip: clientIp(req),          // o browser não sabe o próprio IP; a Meta pede este
  };

  let lead;
  try {
    lead = await db.insertLead(record);
  } catch (err) {
    console.error('[lead] falha ao gravar:', err.message);
    return res.status(500).json({ error: 'não foi possível gravar o lead' });
  }

  res.status(201).json({ id: lead.id, event_id: lead.event_id });

  /* daqui para baixo o usuário já foi para o WhatsApp — nada aqui bloqueia a resposta */
  const settings = await db.getSettings().catch(() => ({}));
  /* reenvio do mesmo event_id não redispara conversão já aceita pela Meta */
  if (lead.capi_status !== 'enviado') await deliver(lead, settings);
  forward(settings.forwardWebhook, lead);
});

async function deliver(lead, settings) {
  const result = await capi.send(
    { pixelId: settings.metaPixelId, token: settings.metaCapiToken, testEventCode: settings.metaTestEventCode },
    capi.buildEvent(lead)
  );
  await db.markCapi(lead.id, {
    status: result.ok ? 'enviado' : 'erro',
    response: { status: result.status, ...result.body },
  }).catch((err) => console.error('[capi] falha ao marcar status:', err.message));
  return result;
}

/* Encaminha o lead cru para n8n/CRM, se configurado. Falha aqui não afeta o CAPI. */
function forward(url, lead) {
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...lead, origem: 'site' }),
  }).catch((err) => console.error('[forward] falhou:', err.message));
}

/* ============ painel ============ */

app.use('/painel', auth, express.static(path.join(ROOT, 'painel')));
app.use('/api/painel', auth);

app.get('/api/painel/config', async (req, res) => {
  const settings = await db.getSettings();
  const out = {};
  ALL_KEYS.forEach((k) => {
    out[k] = SECRET_KEYS.includes(k) ? (settings[k] ? '__CONFIGURADO__' : '') : (settings[k] || '');
  });
  res.json(out);
});

app.put('/api/painel/config', async (req, res) => {
  const patch = {};
  ALL_KEYS.forEach((k) => {
    if (!(k in req.body)) return;
    const value = clean(req.body[k], 500);
    /* campo secreto voltou mascarado = usuário não mexeu nele */
    if (SECRET_KEYS.includes(k) && value === '__CONFIGURADO__') return;
    patch[k] = value;
  });
  await db.saveSettings(patch);
  configCache = null;
  res.json({ ok: true, salvos: Object.keys(patch) });
});

app.get('/api/painel/leads', async (req, res) => {
  res.json(await db.listLeads(req.query));
});

app.get('/api/painel/stats', async (req, res) => {
  res.json(await db.statsByCampaign(req.query.dias));
});

app.post('/api/painel/leads/:id/reenviar', async (req, res) => {
  const lead = await db.getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'lead não encontrado' });
  const settings = await db.getSettings();
  const result = await deliver(lead, settings);
  res.json({ ok: result.ok, status: result.status, resposta: result.body });
});

/* ============ boot ============ */

db.init()
  .then(() => app.listen(PORT, () => console.log(`Orbital em http://localhost:${PORT} — painel em /painel`)))
  .catch((err) => {
    console.error('Falha ao iniciar o banco:', err.message);
    process.exit(1);
  });
