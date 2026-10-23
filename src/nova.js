// Вхід через ігровий акаунт NovaRP (через сервіс nova-auth на ПК, доступ через Cloudflare Tunnel).
'use strict';
const crypto = require('crypto');
let URL_ = (process.env.NOVA_AUTH_URL || '').replace(/\/+$/, ''); const SECRET = process.env.NOVA_AUTH_SECRET || '';
const MODE = process.env.AUTH_MODE || (URL_ || SECRET ? 'nova' : 'local'); // nova | local | both
const ADMIN_LVL = +(process.env.NOVA_ADMIN_LEVEL || 1);
const enabled = () => !!SECRET && MODE !== 'local';
const localAllowed = () => MODE !== 'nova';
// короткий підписаний квиток для вибору персонажа (без зберігання пароля)
const TKEY = crypto.createHash('sha256').update('ticket:' + (SECRET || crypto.randomBytes(16).toString('hex'))).digest();
const sign = o => { const p = Buffer.from(JSON.stringify({ ...o, exp: Date.now() + 5 * 60e3 })).toString('base64url'); return p + '.' + crypto.createHmac('sha256', TKEY).update(p).digest('base64url'); };
const unsign = t => { const [p, s] = String(t || '').split('.'); if (!p || !s) return null; const e = crypto.createHmac('sha256', TKEY).update(p).digest('base64url');
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null; const o = JSON.parse(Buffer.from(p, 'base64url')); return o.exp > Date.now() ? o : null; };
async function verify(login, password, ip) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
  if (!URL_) return { error: 'Сервер гри зараз недоступний. Спробуйте пізніше', code: 503 };
  try { const r = await fetch(URL_ + '/verify', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-auth-secret': SECRET }, body: JSON.stringify({ login, password, client_ip: ip }) });
    if (r.status === 401) return { error: 'Невірний ігровий логін або пароль', code: 401 };
    if (r.status === 429) return { error: 'Забагато спроб. Спробуйте за 10 хвилин', code: 429 };
    if (!r.ok) return { error: 'Сервер гри зараз недоступний. Спробуйте пізніше', code: 503 };
    return await r.json(); } catch { return { error: 'Сервер гри зараз недоступний. Спробуйте пізніше', code: 503 }; } finally { clearTimeout(tm); }
}
/** opts: { eligible(char) -> bool, deny: string, upsert(account, char|null, isAdmin) -> userId, startSession(res, userId) } */
// Тунель на ПК (localhost.run) змінює адресу при перепідключенні — ПК сам повідомляє нову адресу (підпис HMAC спільним секретом).
const URL_RE = /^https:\/\/[a-z0-9-]+\.(lhr\.life|localhost\.run|trycloudflare\.com)$/;
async function loadUrl(db) { try { const r = await db.get("SELECT v FROM kv WHERE k='nova_url'"); if (r && !process.env.NOVA_AUTH_URL_FIXED) URL_ = r.v; } catch {} }
function mount(app, lim, H, opts) {
  const db = opts.db; mountSso(app, lim, H, opts);
  app.post('/api/internal/nova-url', lim, H(async (q, r) => {
    const { url, ts, sig } = q.body || {}; if (!SECRET || !URL_RE.test(String(url)) || Math.abs(Date.now() - +ts) > 300e3) return r.status(400).json({ error: 'bad' });
    const e = crypto.createHmac('sha256', SECRET).update(url + '|' + ts).digest('hex');
    if (String(sig).length !== e.length || !crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(e))) return r.status(401).json({ error: 'bad sig' });
    if (url !== URL_) { await db.run("DELETE FROM kv WHERE k='nova_url'"); await db.run("INSERT INTO kv(k,v) VALUES('nova_url',?)", [url]); URL_ = url; }
    r.json({ ok: 1 }); }));
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
// ===== SSO з гри (F9-планшет / телефон → «Портал»). Специфікація: portal_sso_spec.md =====
const SSO_SECRET = process.env.NOVA_SSO_SECRET || '';
const SSO_AUD = process.env.NOVA_SSO_AUD || '';
function ssoVerify(t) {
  const [p, s] = String(t || '').split('.'); if (!SSO_SECRET || !p || !s || p.length > 4096) return null;
  const e = crypto.createHmac('sha256', SSO_SECRET).update(p).digest('base64url');
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  let o; try { o = JSON.parse(Buffer.from(p, 'base64url')); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (o.v !== 1 || !o.jti || !(o.exp > now) || o.exp - o.iat > 120 || o.iat > now + 30) return null;
  if (SSO_AUD && o.aud !== SSO_AUD) return null;
  if (!o.acc || !Number.isInteger(o.acc.id) || !o.char_id && !(o.acc.admin_level >= ADMIN_LVL)) return null;
  return o;
}
function mountSso(app, lim, H, opts) {
  const db = opts.db;
  app.get('/sso', lim, H(async (q, r) => {
    r.set('Referrer-Policy', 'no-referrer'); r.set('Cache-Control', 'no-store');
    const fail = m => r.status(403).type('html').send(`<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;background:#111;color:#eee;padding:40px"><h2>Вхід не вдався</h2><p>${m}</p><p><a style="color:#8cf" href="/">На головну</a></p>`);
    const o = ssoVerify(q.query.t); if (!o) return fail('Посилання недійсне або застаріло. Відкрийте портал у грі ще раз.');
    await db.run('DELETE FROM sso_used WHERE exp < ?', [Math.floor(Date.now() / 1000)]);
    try { await db.run('INSERT INTO sso_used(jti, exp) VALUES(?,?)', [String(o.jti).slice(0, 64), o.exp]); } catch { return fail('Посилання вже використано.'); }
    if (o.acc.banned) return fail('Ваш ігровий акаунт заблоковано.');
    const admin = o.acc.admin_level >= ADMIN_LVL, c = o.char || null;
    if (c && c.id !== o.char_id) return fail('Невірні дані персонажа.');
    const ok = c && opts.eligible(c);
    if (!ok && !admin) return fail(opts.deny);
    await opts.startSession(r, await opts.upsert({ id: o.acc.id, login: o.acc.login, admin_level: o.acc.admin_level }, ok ? c : null, admin));
    r.redirect(302, '/');
  }));
}
async function start(db) { await db.run('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)'); await loadUrl(db); await db.run('CREATE TABLE IF NOT EXISTS sso_used(jti TEXT PRIMARY KEY, exp INTEGER)'); }
module.exports = { ssoVerify, mount, start, enabled, localAllowed };
