// Держпортал v2 — тимчасові значення (ТЗ §14). Змінюються тут або через змінні середовища на Render.
const n = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? +process.env[k] : d);
module.exports = {
  APPEAL_SLA_HOURS: n('GOV_APPEAL_SLA_HOURS', 48),          // §14.1 строк відповіді на звернення (реальні години)
  PETITION_THRESHOLD: n('GOV_PETITION_THRESHOLD', 25),      // §14.2 підписів для обов'язкової відповіді
  PETITION_TARGET: process.env.GOV_PETITION_TARGET || 'gov', // петиції — лише до Уряду/Мерії (рішення Максима 24.10)
  // §14.3 Суд/прокуратура: як зараз; з P86 суддя/прокурор — посади gov (F9), не адміни.
  // Рішення Максима: суддя і прокурор — ігрові посади (підрозділ/ранг у gov), НЕ адміни. Перехід — окрема фаза.
  COURT_MODE: process.env.GOV_COURT_MODE || 'legacy',       // legacy → gov_positions (пізніша фаза)
  WEB_READ_ONLY: (process.env.GOV_WEB_READ_ONLY || '1') !== '0', // §14.4 веб-портал на Render — лише читання
  ADMIN_OFF_DUTY_MODE: 'player', // рішення Максима (24.10, остаточне): адмін поза /aduty — звичайний гравець; strict не вмикається
  AUDIT_FULL_ADMIN_LEVEL: n('GOV_AUDIT_FULL_LEVEL', 3),     // повний журнал — адмін 3+
};
