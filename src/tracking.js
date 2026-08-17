/* Orbital — camada de rastreamento.
   Carrega Meta Pixel e Google Tag, guarda a atribuição da campanha e envia o
   lead enriquecido para o webhook.

   Deduplicação: o mesmo `event_id` vai no Pixel (browser) e precisa ir no
   `event_id` da Conversions API (servidor). Sem isso a Meta conta o lead duas
   vezes e o otimizador aprende errado. */
(function (root) {
  'use strict';

  var CFG = root.ORBITAL_TRACKING || {};
  var ATTR_KEY = 'orbital_attr';
  var CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid'];
  var UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function cookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : '';
  }

  function urlParams() {
    var p = new URLSearchParams(location.search);
    var out = {};
    UTMS.concat(CLICK_IDS).forEach(function (k) {
      var v = p.get(k);
      if (v) out[k] = v;
    });
    return out;
  }

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* modo privado */ }
  }

  /* Primeiro clique: gravado uma vez e mantido pela janela de atribuição.
     É o que responde "qual campanha trouxe esse lead" quando a pessoa volta depois. */
  function firstTouch() {
    var saved = read(ATTR_KEY);
    var maxAge = (CFG.attributionDays || 90) * 864e5;
    if (saved && Date.now() - (saved.ts || 0) < maxAge) return saved;

    var touch = Object.assign({
      ts: Date.now(),
      first_seen: new Date().toISOString(),
      landing_page: location.origin + location.pathname,
      referrer: document.referrer || '',
    }, urlParams());

    /* _fbc precisa ser montado na chegada: o fbclid some da URL na navegação
       interna, e o cookie do Pixel só existe se o Pixel já tiver carregado. */
    var fbclid = new URLSearchParams(location.search).get('fbclid');
    if (fbclid) touch.fbc = 'fb.1.' + Date.now() + '.' + fbclid;

    write(ATTR_KEY, touch);
    return touch;
  }

  function eventId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'ev-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10);
  }

  /* ---------- carregamento das tags ---------- */

  function loadMetaPixel(id) {
    if (!id || root.fbq) return;
    /* snippet oficial da Meta */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s)
    }(root, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    root.fbq('init', id);
    root.fbq('track', 'PageView');
  }

  function loadGoogleTag(id) {
    if (!id || root.gtag) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    root.dataLayer = root.dataLayer || [];
    root.gtag = function () { root.dataLayer.push(arguments); };
    root.gtag('js', new Date());
    root.gtag('config', id);
  }

  /* ---------- API pública ---------- */

  /* Evento genérico, para micro-conversões (início do formulário, etc.). */
  function event(name, props) {
    var id = eventId();
    if (root.fbq) root.fbq('track', name, props || {}, { eventID: id });
    if (root.gtag) root.gtag('event', name, Object.assign({ event_id: id }, props || {}));
    return id;
  }

  /* Conversão principal. Dispara Pixel + Google e devolve o payload ao webhook,
     que é quem tem token para falar com a Conversions API. */
  function lead(data) {
    var id = eventId();
    var payload = {
      event_name: 'Lead',
      event_id: id,                                  // repetir no CAPI para deduplicar
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: location.href,
      action_source: 'website',
      lead: data,
      attribution: {
        first_touch: firstTouch(),
        last_touch: Object.assign({ referrer: document.referrer || '', page: location.href }, urlParams()),
      },
      meta: {
        fbp: cookie('_fbp'),
        fbc: cookie('_fbc') || (firstTouch().fbc || ''),
      },
      client: {
        user_agent: navigator.userAgent,
        language: navigator.language,
        // client_ip_address: o backend preenche — o browser não conhece o próprio IP
      },
    };

    if (root.fbq) root.fbq('track', 'Lead', { content_name: 'Diagnóstico Orbital' }, { eventID: id });
    if (root.gtag) {
      root.gtag('event', 'generate_lead', { event_id: id, currency: 'BRL', value: 0 });
      if (CFG.googleLeadLabel) {
        root.gtag('event', 'conversion', { send_to: CFG.googleLeadLabel, transaction_id: id });
      }
    }

    if (!CFG.leadWebhook) return Promise.resolve(payload);
    return fetch(CFG.leadWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(function () { /* o lead já seguiu pelo WhatsApp; falha aqui não bloqueia */ });
  }

  loadMetaPixel(CFG.metaPixelId);
  loadGoogleTag(CFG.googleTagId);
  firstTouch();

  root.OrbitalTracking = { lead: lead, event: event, attribution: firstTouch, eventId: eventId };
})(window);
