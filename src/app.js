/* Orbital — comportamento da landing page.
   Depende de src/form-logic.js (global OrbitalForm), carregado antes deste arquivo. */
(function () {
  'use strict';

  /* ======================= CONFIGURAÇÃO ======================= */
  var CONFIG = {
    WA: '5511987959188',  // 55 + DDD + número
    DEFAULT_MSG: 'Olá! Vim pelo site da Orbital e quero saber como automatizar minha empresa com IA.',
  };
  /* Pixels e webhook ficam em src/tracking-config.js */

  var F = window.OrbitalForm;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var clamp01 = function (n) { return Math.min(1, Math.max(0, n)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ======================= LINKS DO WHATSAPP ======================= */
  var defaultHref = F.waHref(CONFIG.WA, CONFIG.DEFAULT_MSG);
  $$('[data-wa]').forEach(function (a) {
    a.href = defaultHref;
    a.target = '_blank';
    a.rel = 'noopener';
  });

  /* ======================= MENU MOBILE ======================= */
  var menu = $('[data-menu]');
  var menuOpen = $('[data-nav-open]');
  function setMenu(open) {
    menu.hidden = !open;
    menuOpen.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }
  menuOpen.addEventListener('click', function () { setMenu(true); });
  $('[data-nav-close]').addEventListener('click', function () { setMenu(false); });
  $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) setMenu(false);
  });

  /* ======================= MANIFESTO: uma palavra por span =======================
     O texto fica no HTML (legível sem JS); aqui só quebramos em spans para poder
     acender palavra por palavra conforme o scroll. */
  var manifestoWords = [];
  var manifestoText = $('[data-manifesto-text]');
  if (manifestoText) {
    var words = manifestoText.textContent.trim().split(/\s+/);
    manifestoText.textContent = '';
    words.forEach(function (w) {
      var span = document.createElement('span');
      span.textContent = w + ' ';
      manifestoText.appendChild(span);
      manifestoWords.push(span);
    });
  }

  /* ======================= REVEAL + CONTADORES ======================= */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-countup')) || 0;
    var grouped = el.hasAttribute('data-sep');
    var fmt = function (n) {
      n = Math.round(n);
      return grouped ? n.toLocaleString('pt-BR') : String(n);
    };
    if (reduceMotion) { el.textContent = fmt(target); return; }
    var start = performance.now();
    var tick = function (now) {
      var p = 1 - Math.pow(1 - clamp01((now - start) / 1500), 3);
      el.textContent = fmt(target * p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function observeOnce(selector, onEnter, rootMargin) {
    var els = $$(selector);
    if (!els.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        onEnter(entry.target);
      });
    }, { rootMargin: rootMargin });
    els.forEach(function (el) { io.observe(el); });
  }

  $$('[data-anim][data-delay]').forEach(function (el) {
    var target = el.classList.contains('line') ? el.firstElementChild : el;
    if (target) target.style.transitionDelay = el.getAttribute('data-delay');
  });
  observeOnce('[data-anim]', function (el) { el.classList.add('is-in'); }, '0px 0px -10% 0px');
  observeOnce('[data-countup]', countUp, '0px 0px -15% 0px');

  /* ======================= EFEITOS DE SCROLL ======================= */
  var header = $('[data-header]');
  var progressBar = $('[data-progress]');
  var pin = $('[data-hpin]');
  var track = $('[data-htrack]');
  var hbar = $('[data-hbar]');
  var hcount = $('[data-hcount]');
  var heroRing = $('[data-hero-ring]');
  var manifesto = $('[data-manifesto]');
  var navLinks = $$('[data-navlink]');
  var SECTION_IDS = ['inicio', 'servicos', 'como-funciona', 'resultados', 'contato'];

  var viewportW = 0, trackW = 0, isNarrow = false;

  /* A altura do bloco fixado define quanto scroll vertical vira scroll horizontal. */
  function measure() {
    isNarrow = window.innerWidth < 820;
    if (!pin || !track) return;
    if (isNarrow) {
      pin.style.height = 'auto';
      track.style.transform = 'none';
      return;
    }
    viewportW = window.innerWidth;
    trackW = track.scrollWidth;
    pin.style.height = (trackW - viewportW + window.innerHeight) + 'px';
  }

  function updateActiveNav(vh) {
    var line = vh * 0.35;
    var active = null;
    SECTION_IDS.forEach(function (id) {
      var section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top <= line) active = id;
    });
    navLinks.forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-navlink') === active);
    });
  }

  function updateManifesto(vh) {
    if (!manifesto || !manifestoWords.length) return;
    var total = manifesto.offsetHeight - vh;
    var prog = clamp01(total > 0 ? (-manifesto.getBoundingClientRect().top + vh * 0.28) / total : 0);
    var lit = Math.round(prog * manifestoWords.length);
    manifestoWords.forEach(function (span, i) { span.classList.toggle('is-lit', i < lit); });
  }

  function onScroll() {
    var y = window.scrollY;
    var vh = window.innerHeight;

    if (header) header.classList.toggle('is-scrolled', y > 30);

    if (progressBar) {
      var maxScroll = document.documentElement.scrollHeight - vh;
      progressBar.style.width = (maxScroll > 0 ? clamp01(y / maxScroll) * 100 : 0) + '%';
    }

    updateActiveNav(vh);

    if (pin && track && !isNarrow) {
      var total = pin.offsetHeight - vh;
      var prog = clamp01(total > 0 ? -pin.getBoundingClientRect().top / total : 0);
      track.style.transform = 'translate3d(' + (-(trackW - viewportW) * prog) + 'px,0,0)';
      if (hbar) hbar.style.width = (prog * 100) + '%';
      if (hcount) hcount.textContent = '0' + Math.min(6, Math.floor(prog * 5.999) + 1);
    }

    updateManifesto(vh);

    if (heroRing && y < vh * 1.4) {
      heroRing.style.transform =
        'translateY(calc(-50% + ' + (y * 0.14) + 'px)) scale(' + (1 + Math.min(y / 2600, 0.28)) + ')';
    }
  }

  var scheduled = false;
  window.addEventListener('scroll', function () {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; onScroll(); });
  }, { passive: true });
  window.addEventListener('resize', function () { measure(); onScroll(); });
  window.addEventListener('load', function () { measure(); onScroll(); });
  /* as fontes mudam a largura do track e, com ela, a altura do bloco fixado */
  if (document.fonts) document.fonts.ready.then(function () { measure(); onScroll(); });
  measure();
  onScroll();

  /* ======================= CURSOR CUSTOMIZADO ======================= */
  var cursor = $('[data-cursor]');
  if (cursor && !window.matchMedia('(pointer:coarse)').matches && !reduceMotion) {
    var mx = window.innerWidth / 2, my = window.innerHeight / 2, cx = mx, cy = my;
    window.addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; });
    (function loop() {
      cx += (mx - cx) * 0.2;
      cy += (my - cy) * 0.2;
      cursor.style.left = cx + 'px';
      cursor.style.top = cy + 'px';
      requestAnimationFrame(loop);
    })();
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest('a,button,[data-cursor-grow]')) cursor.classList.add('is-grown');
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest('a,button,[data-cursor-grow]')) cursor.classList.remove('is-grown');
    });
  } else if (cursor) {
    cursor.remove();
  }

  /* ======================= DEPOIMENTOS ======================= */
  var TESTIMONIALS = [
    { quote: 'Em 60 dias automatizaram nosso atendimento e o time parou de perder lead à noite. O WhatsApp responde e qualifica sozinho.', name: 'Mariana Costa', role: 'CEO · Clínica Viver', initials: 'MC', metric: '+3x', metricLabel: 'leads qualificados por mês' },
    { quote: 'Saímos das planilhas manuais para relatórios automáticos. Hoje decido com dado, não com achismo. Mudou o jogo.', name: 'Rafael Mendes', role: 'Diretor · Loja Prime', initials: 'RM', metric: '−68%', metricLabel: 'de tarefas manuais' },
    { quote: 'A operação roda 24h. Agendamentos, disparos e follow-up acontecem sem ninguém mexer. Um time invisível trabalhando.', name: 'Juliana Alves', role: 'Sócia · Studio Bem', initials: 'JA', metric: '24/7', metricLabel: 'operação no automático' },
  ];

  var tDots = $$('[data-t-dots] .dot');
  var tFields = {
    quote: $('[data-t-quote]'), name: $('[data-t-name]'), role: $('[data-t-role]'),
    initials: $('[data-t-initials]'), metric: $('[data-t-metric]'), metricLabel: $('[data-t-metric-label]'),
  };
  var tIndex = 0, tTimer = null;

  function renderTestimonial() {
    var t = TESTIMONIALS[tIndex];
    Object.keys(tFields).forEach(function (key) {
      if (tFields[key]) tFields[key].textContent = t[key];
    });
    tDots.forEach(function (dot, i) {
      dot.classList.toggle('is-active', i === tIndex);
      dot.setAttribute('aria-selected', String(i === tIndex));
    });
  }
  function rotateTestimonials() {
    clearInterval(tTimer);
    tTimer = setInterval(function () {
      tIndex = (tIndex + 1) % TESTIMONIALS.length;
      renderTestimonial();
    }, 5500);
  }
  tDots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { tIndex = i; renderTestimonial(); rotateTestimonials(); });
  });
  if (tDots.length) rotateTestimonials();

  /* ======================= FORMULÁRIO DE CAPTAÇÃO ======================= */
  var form = $('[data-form]');
  if (form) {
    var success = $('[data-success]');
    var fsteps = $$('.fstep', form);
    var errorEl = $('[data-error]', form);
    var backBtn = $('[data-back]', form);
    var nextBtn = $('[data-next]', form);
    var submitBtn = $('[data-submit]', form);
    var stepLabel = $('[data-step-label]', form);
    var stepCount = $('[data-step-count]', form);
    var stepBar = $('[data-progress-bar]', form);

    var state = {
      step: 0,
      data: { nome: '', empresa: '', telefone: '', segmento: '', faturamento: '', objetivo: '' },
    };

    function setError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = !msg;
    }

    function render(focusInput) {
      fsteps.forEach(function (s) { s.hidden = Number(s.getAttribute('data-step')) !== state.step; });
      stepLabel.textContent = F.LABELS[state.step];
      stepCount.textContent = 'Passo ' + (state.step + 1) + ' de ' + F.TOTAL_STEPS;
      stepBar.style.width = ((state.step + 1) / F.TOTAL_STEPS * 100) + '%';
      backBtn.hidden = state.step === 0;
      nextBtn.hidden = state.step > 2;
      submitBtn.hidden = state.step !== 5;
      if (focusInput) {
        var input = $('input', fsteps[state.step]);
        if (input) input.focus({ preventScroll: true });
      }
    }

    function goTo(step) {
      state.step = step;
      setError('');
      render(true);
    }

    function next() {
      var err = F.validateStep(state.step, state.data);
      if (err) return setError(err);
      goTo(Math.min(F.TOTAL_STEPS - 1, state.step + 1));
    }

    function submitForm() {
      var err = F.validateStep(5, state.data);
      if (err) return setError(err);

      var msg = F.buildMessage(state.data);
      var href = F.waHref(CONFIG.WA, msg);

      /* dispara Pixel + Google e manda o lead com atribuição para o webhook */
      if (window.OrbitalTracking) window.OrbitalTracking.lead(state.data);

      window.open(href, '_blank', 'noopener');

      var finalLink = $('[data-wa-final]');
      if (finalLink) { finalLink.href = href; finalLink.target = '_blank'; finalLink.rel = 'noopener'; }

      form.hidden = true;
      success.hidden = false;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.step === 5) submitForm(); else next();
    });
    backBtn.addEventListener('click', function () { goTo(Math.max(0, state.step - 1)); });

    $$('[data-field]', form).forEach(function (input) {
      input.addEventListener('input', function () {
        if (input.hasAttribute('data-mask-tel')) input.value = F.maskTel(input.value);
        state.data[input.getAttribute('data-field')] = input.value;
        setError('');
      });
    });

    $$('.opts', form).forEach(function (group) {
      var key = group.getAttribute('data-opts');
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('.opt');
        if (!btn) return;
        state.data[key] = btn.textContent.trim();
        $$('.opt', group).forEach(function (b) { b.classList.toggle('is-selected', b === btn); });
        setError('');
        if (key === 'segmento') goTo(4);
        else if (key === 'faturamento') goTo(5);
      });
    });

    render(false);
  }
})();
