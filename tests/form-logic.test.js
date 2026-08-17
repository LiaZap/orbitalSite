/* Verificação da lógica do formulário: node tests/form-logic.test.js */
const assert = require('assert');
const F = require('../src/form-logic.js');

/* ---- máscara de telefone ---- */
assert.strictEqual(F.maskTel(''), '');
assert.strictEqual(F.maskTel('abc'), '');
assert.strictEqual(F.maskTel('1'), '(1');
assert.strictEqual(F.maskTel('11'), '(11');
assert.strictEqual(F.maskTel('119'), '(11) 9');
assert.strictEqual(F.maskTel('1199999'), '(11) 99999');
assert.strictEqual(F.maskTel('11999998888'), '(11) 99999-8888');
assert.strictEqual(F.maskTel('11999998888123'), '(11) 99999-8888', 'trunca em 11 dígitos');
assert.strictEqual(F.maskTel(F.maskTel('11999998888')), '(11) 99999-8888', 'idempotente ao redigitar');
/* fixo de 10 dígitos agrupa como celular — comportamento herdado do protótipo */
assert.strictEqual(F.maskTel('1133334444'), '(11) 33334-444');

/* ---- validação por passo ---- */
assert.match(F.validateStep(0, {}), /nome/i);
assert.match(F.validateStep(0, { nome: '   ' }), /nome/i, 'espaço em branco não conta');
assert.strictEqual(F.validateStep(0, { nome: 'Ana' }), '');

assert.match(F.validateStep(1, { empresa: '' }), /empresa/i);
assert.strictEqual(F.validateStep(1, { empresa: 'Orbital' }), '');

assert.match(F.validateStep(2, { telefone: '(11) 9999' }), /WhatsApp/i, 'menos de 10 dígitos');
assert.strictEqual(F.validateStep(2, { telefone: '(11) 3333-4444' }), '', '10 dígitos passam');
assert.strictEqual(F.validateStep(2, { telefone: '(11) 99999-8888' }), '');

assert.strictEqual(F.validateStep(3, {}), '', 'segmento avança na seleção');
assert.strictEqual(F.validateStep(4, {}), '', 'faturamento avança na seleção');

assert.match(F.validateStep(5, {}), /prioridade/i);
assert.strictEqual(F.validateStep(5, { objetivo: 'Gerar mais leads e vendas' }), '');

/* ---- mensagem e link ---- */
const lead = {
  nome: 'Ana', empresa: 'Acme', telefone: '(11) 99999-8888',
  segmento: 'Serviços', faturamento: 'Até R$ 30 mil', objetivo: 'Automatizar a operação',
};
const msg = F.buildMessage(lead);
Object.values(lead).forEach((v) => assert.ok(msg.includes(v), `mensagem deve conter "${v}"`));

const href = F.waHref('55 (11) 99999-9999', msg);
assert.ok(href.startsWith('https://wa.me/5511999999999?text='), 'número só com dígitos');
assert.ok(!href.includes(' '), 'texto precisa vir codificado');
assert.strictEqual(decodeURIComponent(href.split('?text=')[1]), msg);

console.log('ok — todas as verificações passaram');
