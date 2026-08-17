/* Postgres: pool, schema e as consultas do painel.
   O schema roda no boot — idempotente, sem ferramenta de migração para duas tabelas. */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS leads (
  id               BIGSERIAL PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  nome             TEXT NOT NULL,
  empresa          TEXT,
  telefone         TEXT,
  segmento         TEXT,
  faturamento      TEXT,
  objetivo         TEXT,
  event_id         TEXT UNIQUE,
  event_time       BIGINT,
  event_source_url TEXT,
  attribution      JSONB NOT NULL DEFAULT '{}'::jsonb,
  fbp              TEXT,
  fbc              TEXT,
  user_agent       TEXT,
  ip               TEXT,
  capi_status      TEXT NOT NULL DEFAULT 'pendente',
  capi_attempts    INT  NOT NULL DEFAULT 0,
  capi_response    JSONB,
  capi_sent_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS leads_created_idx  ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx   ON leads (capi_status);
CREATE INDEX IF NOT EXISTS leads_campaign_idx ON leads ((attribution -> 'first_touch' ->> 'utm_campaign'));
`;

async function init() {
  await pool.query(SCHEMA);
}

/* ---------- settings ---------- */

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function saveSettings(patch) {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  await pool.query(
    `INSERT INTO settings (key, value)
     SELECT * FROM UNNEST($1::text[], $2::text[])
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [entries.map((e) => e[0]), entries.map((e) => String(e[1] ?? ''))]
  );
}

/* ---------- leads ---------- */

/* event_id é UNIQUE: se o browser reenviar o mesmo evento, devolvemos o lead que
   já existe em vez de duplicar a conversão. */
async function insertLead(lead) {
  const { rows } = await pool.query(
    `INSERT INTO leads (nome, empresa, telefone, segmento, faturamento, objetivo,
                        event_id, event_time, event_source_url, attribution, fbp, fbc, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (event_id) DO UPDATE SET event_id = EXCLUDED.event_id
     RETURNING *`,
    [lead.nome, lead.empresa, lead.telefone, lead.segmento, lead.faturamento, lead.objetivo,
      lead.event_id, lead.event_time, lead.event_source_url, lead.attribution,
      lead.fbp, lead.fbc, lead.user_agent, lead.ip]
  );
  return rows[0];
}

async function getLead(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric < 1) return null;
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [numeric]);
  return rows[0] || null;
}

async function markCapi(id, { status, response }) {
  await pool.query(
    `UPDATE leads
        SET capi_status = $2, capi_response = $3,
            capi_attempts = capi_attempts + 1, capi_sent_at = now()
      WHERE id = $1`,
    [id, status, response ? JSON.stringify(response) : null]
  );
}

async function listLeads({ limit = 100, offset = 0, status = '', campanha = '', desde = '' }) {
  const where = [];
  const args = [];
  if (status) { args.push(status); where.push(`capi_status = $${args.length}`); }
  if (campanha) { args.push(campanha); where.push(`attribution -> 'first_touch' ->> 'utm_campaign' = $${args.length}`); }
  if (desde) { args.push(desde); where.push(`created_at >= $${args.length}`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  args.push(Math.min(Number(limit) || 100, 500));
  args.push(Math.max(Number(offset) || 0, 0));

  const { rows } = await pool.query(
    `SELECT id, created_at, nome, empresa, telefone, segmento, faturamento, objetivo,
            capi_status, capi_attempts, capi_response, attribution
       FROM leads ${clause}
      ORDER BY created_at DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  const total = await pool.query(`SELECT count(*)::int AS n FROM leads ${clause}`, args.slice(0, where.length));
  return { rows, total: total.rows[0].n };
}

/* Resumo por campanha de primeiro clique — é o que responde "qual anúncio traz lead". */
async function statsByCampaign(dias = 30) {
  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(attribution -> 'first_touch' ->> 'utm_source', ''), 'direto')   AS origem,
            COALESCE(NULLIF(attribution -> 'first_touch' ->> 'utm_campaign', ''), '—')      AS campanha,
            count(*)::int                                              AS leads,
            count(*) FILTER (WHERE capi_status = 'enviado')::int        AS enviados,
            count(*) FILTER (WHERE capi_status = 'erro')::int           AS erros
       FROM leads
      WHERE created_at >= now() - ($1::int * INTERVAL '1 day')
      GROUP BY 1, 2
      ORDER BY leads DESC`,
    [Math.min(Math.max(Number(dias) || 30, 1), 365)]
  );
  return rows;
}

module.exports = {
  pool, init, getSettings, saveSettings,
  insertLead, getLead, markCapi, listLeads, statsByCampaign,
};
