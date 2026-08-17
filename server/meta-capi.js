/* Conversions API da Meta.
   O PII precisa ir com SHA-256 do valor normalizado — hash de string fora do
   padrão da Meta não casa com nenhum usuário e o evento vira lixo silencioso:
   a API responde 200 e a correspondência simplesmente não acontece. */
const crypto = require('crypto');

const GRAPH_VERSION = 'v21.0';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

/* Telefone: só dígitos, com DDI, sem "+" nem zero à esquerda.
   No Brasil um número nacional tem 10 (fixo) ou 11 (celular) dígitos contando o
   DDD — só nesse caso prefixamos 55. Assim o DDD 55 (Santa Maria/RS) não é
   confundido com o código do país. */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

/* Nome: minúsculo, sem pontuação, espaços colapsados. Acentos a Meta mantém. */
function normalizeName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitName(fullName) {
  const parts = normalizeName(fullName).split(' ').filter(Boolean);
  return { fn: parts[0] || '', ln: parts.slice(1).join(' ') };
}

/* Monta o evento no formato da Meta a partir da linha do banco. */
function buildEvent(lead) {
  const { fn, ln } = splitName(lead.nome);
  const phone = normalizePhone(lead.telefone);
  const attribution = lead.attribution || {};
  const first = attribution.first_touch || {};

  const user_data = {};
  if (phone) user_data.ph = [sha256(phone)];
  if (fn) user_data.fn = [sha256(fn)];
  if (ln) user_data.ln = [sha256(ln)];
  /* estes NÃO são hasheados — a Meta usa em claro */
  if (lead.fbp) user_data.fbp = lead.fbp;
  if (lead.fbc) user_data.fbc = lead.fbc;
  if (lead.ip) user_data.client_ip_address = lead.ip;
  if (lead.user_agent) user_data.client_user_agent = lead.user_agent;

  return {
    event_name: 'Lead',
    event_time: Number(lead.event_time) || Math.floor(Date.now() / 1000),
    event_id: lead.event_id || undefined,   // mesmo id do Pixel = deduplicação
    event_source_url: lead.event_source_url || undefined,
    action_source: 'website',
    user_data,
    custom_data: {
      content_name: 'Diagnóstico Orbital',
      empresa: lead.empresa || '',
      segmento: lead.segmento || '',
      faturamento: lead.faturamento || '',
      objetivo: lead.objetivo || '',
      utm_source: first.utm_source || '',
      utm_campaign: first.utm_campaign || '',
      utm_content: first.utm_content || '',
    },
  };
}

/* A Meta rejeita eventos com mais de 7 dias. Reenvio manual de lead antigo
   entraria como inválido, então travamos no limite. */
function clampEventTime(seconds) {
  const now = Math.floor(Date.now() / 1000);
  const oldest = now - 7 * 86400 + 3600;
  return Math.min(now, Math.max(Number(seconds) || now, oldest));
}

async function send({ pixelId, token, testEventCode }, event) {
  if (!pixelId || !token) {
    return { ok: false, status: 0, body: { error: 'metaPixelId ou metaCapiToken não configurados no painel' } };
  }

  const payload = { data: [{ ...event, event_time: clampEventTime(event.event_time) }] };
  if (testEventCode) payload.test_event_code = testEventCode;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: String(err && err.message || err) } };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sha256, normalizePhone, normalizeName, splitName, buildEvent, clampEventTime, send };
