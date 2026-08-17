/* Verificação do envio para a Conversions API: node tests/meta-capi.test.js
   O risco real aqui é silencioso — a Meta responde 200 para PII mal normalizado
   e o evento simplesmente não casa com ninguém. */
const assert = require('assert');
const crypto = require('crypto');
const capi = require('../server/meta-capi.js');

const sha = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

/* ---- telefone: só dígitos, com DDI ---- */
assert.strictEqual(capi.normalizePhone('(11) 98795-9188'), '5511987959188', 'celular nacional ganha 55');
assert.strictEqual(capi.normalizePhone('11 3333-4444'), '551133334444', 'fixo de 10 dígitos ganha 55');
assert.strictEqual(capi.normalizePhone('+55 (11) 98795-9188'), '5511987959188', 'já com DDI não duplica');
assert.strictEqual(capi.normalizePhone('5511987959188'), '5511987959188');
assert.strictEqual(capi.normalizePhone('55 98765-4321'), '5555987654321', 'DDD 55 não é confundido com o DDI');
assert.strictEqual(capi.normalizePhone('011 98795-9188'), '5511987959188', 'zero à esquerda cai fora');
assert.strictEqual(capi.normalizePhone(''), '');
assert.strictEqual(capi.normalizePhone('abc'), '');

/* ---- nome: minúsculo, sem pontuação, acento preservado ---- */
assert.deepStrictEqual(capi.splitName('Mariana Costa'), { fn: 'mariana', ln: 'costa' });
assert.deepStrictEqual(capi.splitName('  ANA   MARIA  SILVA '), { fn: 'ana', ln: 'maria silva' });
assert.deepStrictEqual(capi.splitName('Rafael'), { fn: 'rafael', ln: '' });
assert.deepStrictEqual(capi.splitName('João D\'Ávila'), { fn: 'joão', ln: 'dávila' }, 'acento fica, apóstrofo sai');
assert.deepStrictEqual(capi.splitName(''), { fn: '', ln: '' });

/* ---- evento: o que é hasheado e o que não é ---- */
const lead = {
  nome: 'Mariana Costa',
  empresa: 'Clínica Viver',
  telefone: '(11) 98795-9188',
  segmento: 'Saúde',
  faturamento: 'R$ 30 mil a R$ 100 mil',
  objetivo: 'Automatizar a operação',
  event_id: 'abc-123',
  event_time: 1700000000,
  event_source_url: 'https://orbital.ag/?utm_campaign=black',
  fbp: 'fb.1.1700000000.987654321',
  fbc: 'fb.1.1700000000.IwAR0abc',
  ip: '200.1.2.3',
  user_agent: 'Mozilla/5.0',
  attribution: { first_touch: { utm_source: 'facebook', utm_campaign: 'black-friday' } },
};

const ev = capi.buildEvent(lead);

assert.strictEqual(ev.event_name, 'Lead');
assert.strictEqual(ev.event_id, 'abc-123', 'event_id precisa bater com o do Pixel para deduplicar');
assert.strictEqual(ev.action_source, 'website');

assert.deepStrictEqual(ev.user_data.ph, [sha('5511987959188')], 'telefone hasheado JÁ normalizado');
assert.deepStrictEqual(ev.user_data.fn, [sha('mariana')]);
assert.deepStrictEqual(ev.user_data.ln, [sha('costa')]);

/* estes vão em claro — hashear quebra a correspondência */
assert.strictEqual(ev.user_data.fbp, lead.fbp);
assert.strictEqual(ev.user_data.fbc, lead.fbc);
assert.strictEqual(ev.user_data.client_ip_address, '200.1.2.3');
assert.strictEqual(ev.user_data.client_user_agent, 'Mozilla/5.0');

/* nenhum PII pode vazar em texto puro */
const raw = JSON.stringify(ev.user_data);
['Mariana', 'mariana', 'Costa', '98795', '9188'].forEach((needle) => {
  assert.ok(!raw.includes(needle), `user_data não pode conter "${needle}" em claro`);
});

assert.strictEqual(ev.custom_data.utm_campaign, 'black-friday', 'campanha de primeiro clique vai junto');
assert.strictEqual(ev.custom_data.segmento, 'Saúde');

/* sem telefone/nome o evento ainda é válido, só com menos sinal */
const magro = capi.buildEvent({ nome: '', telefone: '', fbp: 'fb.1.2.3' });
assert.ok(!('ph' in magro.user_data) && !('fn' in magro.user_data));
assert.strictEqual(magro.user_data.fbp, 'fb.1.2.3');

/* ---- janela de 7 dias ---- */
const agora = Math.floor(Date.now() / 1000);
assert.strictEqual(capi.clampEventTime(agora), agora);
assert.ok(capi.clampEventTime(agora + 9999) <= agora, 'futuro é travado no agora');
assert.ok(capi.clampEventTime(1700000000) > agora - 7 * 86400, 'evento antigo entra na janela');

console.log('ok — Conversions API verificada');
