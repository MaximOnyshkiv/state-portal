// Вхід через ігровий акаунт NovaRP (через сервіс nova-auth на ПК, доступ через Cloudflare Tunnel).
'use strict';
const crypto = require('crypto');
const URL_ = (process.env.NOVA_AUTH_URL || '').replace(/\/+$/, ''), SECRET = process.env.NOVA_AUTH_SECRET || '';
const MODE = process.env.AUTH_MODE || (URL_ ? 'nova' : 'local'); // nova | local | both
const ADMIN_LVL = +(process.env.NOVA_ADMIN_LEVEL || 1);
const enabled = () => !!(URL_ && SECRET) && MODE !== 'local';
const localAllowed = () => MODE !== 'nova';
// короткий підписаний квиток для вибору персонажа (без зберігання пароля)
const TKEY = crypto.createHash('sha256').update('ticket:' + (SECRET || crypto.randomBytes(16).toString('hex'))).digest();
const sign = o => { const p = Buffer.from(JSON.stringify({ ...o, exp: Date.now() + 5 * 60e3 })).toString('base64url'); return p + '.' + crypto.createHmac('sha256', TKEY).update(p).digest('base64url'); };
const unsign = t => { const [p, s] = String(t || '').split('.'); if (!p || !s) return null; const e = crypto.createHmac('sha256', TKEY).update(p).digest('base64url');
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null; const o = JSON.parse(Buffer.from(p, 'base64url')); return o.exp > Date.now() ? o : null; };
async function verify(login, password, ip) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(URL_ + '/verify', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-auth-secret': SECRET }, body: JSON.stringify({ login, password, client_ip: ip }) });
    if (r.status === 401) return { error: 'Невірний ігровий логін або пароль', code: 401 };
    if (r.status === 429) return { error: 'Забагато спроб. Спробуйте за 10 хвилин', code: 429 };
    if (!r.ok) return { error: 'Сервер гри зараз недоступний. Спробуйте пізніше', code: 503 };
    return await r.json(); } catch { return { error: 'Сервер гри зараз недоступний. Спробуйте пізніше', code: 503 }; } finally { clearTimeout(tm); }
}
/** opts: { eligible(char) -> bool, deny: string, upsert(account, char|null, isAdmin) -> userId, startSession(res, userId) } */
function mount(app, lim, H, opts) {
  app.get('/api/auth/mode', (q, r) => r.json({ nova: enabled(), local: localAllowed() }));
  app.post('/api/login/game', lim, H(async (q, r) => {
    if (!enabled()) return r.status(400).json({ error: 'Вхід через гру вимкнено' });
    const v = await verify(String(q.body.login || '').trim(), String(q.body.password || ''), q.ip);
    if (v.error) return r.status(v.code).json({ error: v.error });
    if (v.account.banned) return r.status(403).json({ error: 'Ваш ігровий акаунт заблоковано' + (v.account.banned_until ? ' до ' + new Date(v.account.banned_until).toLocaleString('uk-UA') : '') });
    const admin = v.account.admin_level >= ADMIN_LVL, chars = v.characters.filter(opts.eligible);
    if (!chars.length && !admin) return r.status(403).json({ error: opts.deny });
    const acc = { id: v.account.id, login: v.account.login, admin_level: v.account.admin_level };
    if (chars.length > 1) return r.json({ choose: chars.map(c => ({ id: c.id, name: c.name, faction: c.faction, rank: c.rank })), ticket: sign({ acc, chars, admin }) });
    await opts.startSession(r, await opts.upsert(acc, chars[0] || null, admin)); r.json({ ok: 1 });
  }));
  app.post('/api/login/char', lim, H(async (q, r) => {
    const t = unsign(q.body.ticket); if (!t) return r.status(400).json({ error: 'Сесія вибору застаріла, увійдіть знову' });
    const c = t.chars.find(c => c.id === +q.body.char_id); if (!c) return r.status(400).json({ error: 'Оберіть персонажа' });
    await opts.startSession(r, await opts.upsert(t.acc, c, t.admin)); r.json({ ok: 1 });
  }));
}
module.exports = { mount, enabled, localAllowed };
