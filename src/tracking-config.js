/* Configuração de rastreamento — o único arquivo que muda por ambiente/cliente.
   Nada aqui é segredo: tudo é visível no browser. Tokens (CAPI, Google Ads API)
   NUNCA entram neste arquivo — eles vivem só no backend que recebe o webhook. */
window.ORBITAL_TRACKING = {
  /* Meta Pixel — só o ID numérico. Ex.: '1234567890123456' */
  metaPixelId: '',

  /* Google: 'G-XXXXXXXXXX' (GA4) ou 'AW-123456789' (Google Ads) */
  googleTagId: '',

  /* Rótulo da conversão de lead no Google Ads: 'AW-123456789/AbC-D_efGhIj' */
  googleLeadLabel: '',

  /* Endpoint que recebe o lead + atribuição (n8n, função serverless, API própria).
     É ele quem faz o hash do PII e dispara a Conversions API da Meta. */
  leadWebhook: '',

  /* Janela de atribuição de primeiro clique, em dias. */
  attributionDays: 90,
};
