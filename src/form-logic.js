/* Lógica pura do formulário de captação — sem DOM, para poder ser testada.
   Carregado como script clássico no browser (global `OrbitalForm`)
   e via require() no Node (tests/form-logic.test.js). */
(function (root) {
  'use strict';

  var LABELS = ['Sobre você', 'Sua empresa', 'Contato', 'Segmento', 'Faturamento', 'Prioridade'];
  var TOTAL_STEPS = LABELS.length;

  /* (11) 98888-7777 — aceita fixo (10 dígitos) e celular (11). */
  function maskTel(raw) {
    var v = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (!v.length) return '';
    var out = '(' + v.slice(0, 2);
    if (v.length >= 3) out += ') ' + v.slice(2, 7);
    if (v.length >= 8) out += '-' + v.slice(7, 11);
    return out;
  }

  /* Retorna "" quando o passo pode avançar, ou a mensagem de erro. */
  function validateStep(step, data) {
    var d = data || {};
    if (step === 0 && !String(d.nome || '').trim()) return 'Digite seu nome para continuar.';
    if (step === 1 && !String(d.empresa || '').trim()) return 'Informe o nome da empresa.';
    if (step === 2 && String(d.telefone || '').replace(/\D/g, '').length < 10) return 'Informe um WhatsApp válido com DDD.';
    if (step === 5 && !d.objetivo) return 'Selecione a prioridade para continuar.';
    return '';
  }

  function buildMessage(d) {
    return 'Olá, Orbital! Sou ' + d.nome + ', da empresa ' + d.empresa +
      '. Segmento: ' + d.segmento +
      '. Faturamento mensal: ' + d.faturamento +
      '. Prioridade agora: ' + d.objetivo +
      '. Meu WhatsApp é ' + d.telefone +
      '. Quero agendar um diagnóstico gratuito.';
  }

  function waHref(number, msg) {
    return 'https://wa.me/' + String(number).replace(/\D/g, '') + '?text=' + encodeURIComponent(msg);
  }

  var api = {
    LABELS: LABELS,
    TOTAL_STEPS: TOTAL_STEPS,
    maskTel: maskTel,
    validateStep: validateStep,
    buildMessage: buildMessage,
    waHref: waHref,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrbitalForm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
