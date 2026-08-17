/* Painel Orbital — config e leads. As rotas /api/painel/* já exigem Basic Auth,
   então o browser reenvia a credencial sozinho. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  async function api(path, options) {
    var res = await fetch('/api/painel' + path, options);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* ---------- abas ---------- */
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
      $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab.dataset.view; });
    });
  });

  /* ---------- configuração ---------- */
  var configForm = $('[data-config]');
  var configMsg = $('[data-config-msg]');

  function setMsg(text, kind) {
    configMsg.textContent = text;
    configMsg.className = 'msg' + (kind ? ' msg--' + kind : '');
  }

  api('/config').then(function (cfg) {
    Object.keys(cfg).forEach(function (key) {
      var field = configForm.elements[key];
      if (field) field.value = cfg[key];
    });
  }).catch(function () { setMsg('Não foi possível carregar a configuração.', 'err'); });

  configForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    setMsg('Salvando…');
    var body = {};
    $$('input, select', configForm).forEach(function (f) { if (f.name) body[f.name] = f.value; });
    try {
      await api('/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setMsg('Salvo. O site passa a usar em até 1 minuto (cache do tracking-config).', 'ok');
    } catch (err) {
      setMsg('Falhou: ' + err.message, 'err');
    }
  });

  /* ---------- resumo e campanhas ---------- */
  async function loadStats() {
    var rows = await api('/stats?dias=30');
    var total = rows.reduce(function (a, r) { return a + r.leads; }, 0);
    var enviados = rows.reduce(function (a, r) { return a + r.enviados; }, 0);
    var erros = rows.reduce(function (a, r) { return a + r.erros; }, 0);
    var taxa = total ? Math.round(enviados / total * 100) : 0;

    $('[data-summary]').innerHTML = [
      ['', total, 'leads em 30 dias'],
      ['card--ok', enviados, 'entregues no CAPI'],
      [erros ? 'card--err' : '', erros, 'com erro de envio'],
      ['', taxa + '%', 'taxa de entrega'],
    ].map(function (c) {
      return '<div class="card ' + c[0] + '"><b>' + esc(c[1]) + '</b><span>' + c[2] + '</span></div>';
    }).join('');

    $('[data-stats]').innerHTML = rows.length
      ? rows.map(function (r) {
        return '<tr><td>' + esc(r.origem) + '</td><td>' + esc(r.campanha) + '</td>' +
          '<td class="n">' + r.leads + '</td><td class="n">' + r.enviados + '</td>' +
          '<td class="n">' + (r.erros || '—') + '</td></tr>';
      }).join('')
      : '<tr><td colspan="5" class="empty">Nenhum lead ainda.</td></tr>';
  }

  /* ---------- leads ---------- */
  var PAGE = 50;
  var offset = 0;
  var loaded = [];
  var tbody = $('[data-leads]');
  var moreBtn = $('[data-more]');
  var filters = $('[data-filters]');

  function query() {
    var data = new FormData(filters);
    var q = new URLSearchParams({ limit: PAGE, offset: offset });
    ['status', 'campanha', 'desde'].forEach(function (k) {
      var v = String(data.get(k) || '').trim();
      if (v) q.set(k, v);
    });
    return q.toString();
  }

  function campaignOf(lead) {
    var first = (lead.attribution || {}).first_touch || {};
    return first.utm_campaign || first.utm_source || (first.referrer ? 'ref: ' + first.referrer : 'direto');
  }

  function row(lead) {
    var status = lead.capi_status || 'pendente';
    var detail = lead.capi_response ? JSON.stringify(lead.capi_response) : '';
    return '<tr>' +
      '<td>' + new Date(lead.created_at).toLocaleString('pt-BR') + '</td>' +
      '<td>' + esc(lead.nome) + '</td>' +
      '<td>' + esc(lead.empresa) + '</td>' +
      '<td>' + esc(lead.telefone) + '</td>' +
      '<td>' + esc(lead.segmento) + '</td>' +
      '<td>' + esc(lead.faturamento) + '</td>' +
      '<td>' + esc(lead.objetivo) + '</td>' +
      '<td>' + esc(campaignOf(lead)) + '</td>' +
      '<td><span class="pill pill--' + esc(status) + '" title="' + esc(detail) + '">' + esc(status) + '</span></td>' +
      '<td><button type="button" class="btn btn--ghost btn--mini" data-resend="' + lead.id + '">Reenviar</button></td>' +
      '</tr>';
  }

  async function loadLeads(reset) {
    if (reset) { offset = 0; loaded = []; tbody.innerHTML = '<tr><td colspan="10" class="empty">Carregando…</td></tr>'; }
    var data = await api('/leads?' + query());
    loaded = loaded.concat(data.rows);
    tbody.innerHTML = loaded.length ? loaded.map(row).join('') : '<tr><td colspan="10" class="empty">Nenhum lead com esse filtro.</td></tr>';
    offset = loaded.length;
    moreBtn.hidden = loaded.length >= data.total;
  }

  filters.addEventListener('submit', function (e) { e.preventDefault(); loadLeads(true).catch(showError); });
  moreBtn.addEventListener('click', function () { loadLeads(false).catch(showError); });

  tbody.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-resend]');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      var result = await api('/leads/' + btn.dataset.resend + '/reenviar', { method: 'POST' });
      btn.textContent = result.ok ? 'Enviado' : 'Erro';
      if (!result.ok) alert('A Meta recusou:\n\n' + JSON.stringify(result.resposta, null, 2));
      await loadLeads(true);
      await loadStats();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Reenviar';
      alert('Falhou: ' + err.message);
    }
  });

  /* CSV do que está carregado na tela — o filtro atual define o recorte. */
  $('[data-export]').addEventListener('click', function () {
    if (!loaded.length) return;
    var cols = ['created_at', 'nome', 'empresa', 'telefone', 'segmento', 'faturamento', 'objetivo', 'capi_status'];
    var lines = [cols.concat('campanha').join(';')];
    loaded.forEach(function (lead) {
      lines.push(cols.map(function (c) {
        return '"' + String(lead[c] == null ? '' : lead[c]).replace(/"/g, '""') + '"';
      }).concat('"' + campaignOf(lead) + '"').join(';'));
    });
    var url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'leads-orbital.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  function showError(err) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">Erro ao carregar: ' + esc(err.message) + '</td></tr>';
  }

  loadStats().catch(function () { $('[data-stats]').innerHTML = '<tr><td colspan="5" class="empty">Erro ao carregar.</td></tr>'; });
  loadLeads(true).catch(showError);
})();
