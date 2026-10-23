// Державний портал — єдина система для державних фракцій.
const express = require('express'), helmet = require('helmet'), cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit'), bcrypt = require('bcryptjs'), crypto = require('crypto'), path = require('path');
const db = require('./db');
const now = () => Date.now();
const DEFAULT_FACTIONS = (process.env.FACTIONS || 'gov:Уряд:Кабінет Міністрів та Мерія,gov:СБУ:Служба безпеки України,npu:НПУ:Національна поліція,obl:Обласна поліція:Поліція області,zsu:ЗСУ:Збройні сили,moz:МОЗ:Міністерство охорони здоров\'я,dsns:ДСНС:Служба надзвичайних ситуацій,tsn:ТСН:Державне телебачення,fib:FIB:Федеральне бюро розслідувань')
  .split(',').map((s, i) => { const [k, name, descr] = s.split(':'); return { code: k === 'gov' ? (name === 'Уряд' ? 'gov' : 'sbu') : k, name, descr, overseer: k === 'gov' ? 1 : 0, sort: i }; });

const SCHEMA = (pg) => { const id = pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT', big = pg ? 'BIGINT' : 'INTEGER'; return [
  `CREATE TABLE IF NOT EXISTS factions(id ${id}, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, descr TEXT, overseer INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, ranks TEXT)`,
  `CREATE TABLE IF NOT EXISTS users(id ${id}, login TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, name TEXT NOT NULL, static_id TEXT, faction_id INTEGER, rank INTEGER NOT NULL DEFAULT 1,
     role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active', demo INTEGER NOT NULL DEFAULT 0, created_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS docs(id ${id}, faction_id INTEGER NOT NULL, to_faction_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, access TEXT NOT NULL DEFAULT 'internal',
     author_id INTEGER, demo INTEGER NOT NULL DEFAULT 0, created_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS requests(id ${id}, from_f INTEGER NOT NULL, to_f INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'Нова', answer TEXT,
     author_id INTEGER, demo INTEGER NOT NULL DEFAULT 0, created_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS complaints(id ${id}, faction_id INTEGER, name TEXT NOT NULL, contact TEXT, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Нова', answer TEXT, demo INTEGER NOT NULL DEFAULT 0, created_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS appointments(id ${id}, faction_id INTEGER NOT NULL, name TEXT NOT NULL, contact TEXT, topic TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Очікує', demo INTEGER NOT NULL DEFAULT 0, created_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS wanted(id ${id}, faction_id INTEGER, name TEXT NOT NULL, reason TEXT, level INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0, created_at ${big} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit(id ${id}, user_id INTEGER, action TEXT NOT NULL, details TEXT, created_at ${big} NOT NULL)`,
]; };
const DEF_RANKS = ['Стажер','Молодший співробітник','Співробітник','Старший співробітник','Інспектор','Старший інспектор','Офіцер','Старший офіцер','Заступник начальника відділу','Начальник відділу','Заступник керівника','Керівник фракції'];

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' })); app.use(cookieParser());
app.get('/healthz', (q, r) => r.send('ok'));
app.use(express.static(path.join(__dirname, '..', 'public'), { etag: true, setHeaders: r => r.setHeader('Cache-Control', 'no-cache') }));
const H = fn => (q, r) => Promise.resolve(fn(q, r)).catch(e => { console.error(e); r.status(500).json({ error: 'Помилка сервера' }); });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const audit = (uid, action, details) => db.run('INSERT INTO audit(user_id,action,details,created_at) VALUES(?,?,?,?)', [uid, action, details || '', now()]);

let F = {}; // id -> faction
async function loadF() { F = {}; for (const f of await db.all('SELECT * FROM factions ORDER BY sort')) { f.ranks = f.ranks ? JSON.parse(f.ranks) : DEF_RANKS; F[f.id] = f; } }

async function auth(q, r, next) {
  const t = q.cookies.sp; if (t) { const s = await db.get('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?', [sha(t), now()]);
    if (s) { const u = await db.get("SELECT * FROM users WHERE id=? AND status='active'", [s.user_id]); if (u) q.u = u; } }
  next();
}
app.use((q, r, n) => auth(q, r, n).catch(n));
// --- hierarchy ---
const isAdmin = u => u && u.role === 'admin';
const isOverseer = u => u && F[u.faction_id] && F[u.faction_id].overseer && (u.role === 'leader' || u.rank >= 9);
const canView = (u, fid) => isAdmin(u) || (u && F[u.faction_id] && F[u.faction_id].overseer) || (u && u.faction_id === fid);
const isLeaderOf = (u, fid) => u && u.faction_id === fid && (u.role === 'leader' || u.rank >= 11);
const canManage = (u, fid) => isAdmin(u) || isLeaderOf(u, fid) || (isOverseer(u) && u.faction_id !== fid);
const need = (q, r) => { if (!q.u) { r.status(401).json({ error: 'Потрібен вхід' }); return false; } return true; };
const pub = u => u && ({ id: u.id, login: u.login, name: u.name, static_id: u.static_id, faction_id: u.faction_id, rank: u.rank, role: u.role, demo: u.demo });

// --- auth ---
const lim = rateLimit({ windowMs: 10 * 60e3, max: 30 });
app.post('/api/login', lim, H(async (q, r) => {
  const u = await db.get("SELECT * FROM users WHERE login=? AND status='active'", [String(q.body.login || '').trim().toLowerCase()]);
  if (!u || !bcrypt.compareSync(String(q.body.password || ''), u.pass_hash)) return r.status(401).json({ error: 'Невірний логін або пароль' });
  const t = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', [sha(t), u.id, now() + 14 * 864e5]);
  r.cookie('sp', t, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 14 * 864e5 }); r.json({ ok: 1 });
}));
app.post('/api/logout', H(async (q, r) => { if (q.cookies.sp) await db.run('DELETE FROM sessions WHERE token_hash=?', [sha(q.cookies.sp)]); r.clearCookie('sp'); r.json({ ok: 1 }); }));
app.get('/api/me', (q, r) => r.json({ user: pub(q.u), overseer: !!isOverseer(q.u), overseerView: !!(q.u && F[q.u.faction_id] && F[q.u.faction_id].overseer), admin: isAdmin(q.u),
  leader: !!(q.u && isLeaderOf(q.u, q.u.faction_id)), factions: Object.values(F).map(f => ({ id: f.id, code: f.code, name: f.name, descr: f.descr, overseer: f.overseer, ranks: f.ranks })) }));

// --- public citizens' layer ---
app.get('/api/public', H(async (q, r) => r.json({
  news: await db.all("SELECT d.id,d.title,d.body,d.faction_id,d.created_at,d.demo FROM docs d WHERE d.kind='news' AND d.access='public' ORDER BY d.id DESC LIMIT 12"),
  orders: await db.all("SELECT id,title,faction_id,kind,created_at FROM docs WHERE kind IN('order','directive') AND access='public' ORDER BY id DESC LIMIT 8"),
  wanted: await db.all('SELECT id,name,reason,level,faction_id,demo FROM wanted WHERE active=1 ORDER BY level DESC, id DESC'),
  stats: await db.all("SELECT faction_id, COUNT(*) n FROM users WHERE status='active' AND faction_id IS NOT NULL GROUP BY faction_id"),
})));
const pubLim = rateLimit({ windowMs: 10 * 60e3, max: 10 });
app.post('/api/public/complaint', pubLim, H(async (q, r) => { const b = q.body;
  if (!b.name || !b.body) return r.status(400).json({ error: 'Заповніть імʼя та текст' });
  const x = await db.run('INSERT INTO complaints(faction_id,name,contact,body,created_at) VALUES(?,?,?,?,?)', [+b.faction_id || null, String(b.name).slice(0, 80), String(b.contact || '').slice(0, 80), String(b.body).slice(0, 3000), now()]);
  r.json({ ok: 1, no: 'СК-' + x.id }); }));
app.post('/api/public/appointment', pubLim, H(async (q, r) => { const b = q.body;
  if (!F[+b.faction_id] || !b.name || !b.topic) return r.status(400).json({ error: 'Заповніть всі поля' });
  const x = await db.run('INSERT INTO appointments(faction_id,name,contact,topic,created_at) VALUES(?,?,?,?,?)', [+b.faction_id, String(b.name).slice(0, 80), String(b.contact || '').slice(0, 80), String(b.topic).slice(0, 1000), now()]);
  r.json({ ok: 1, no: 'ЗП-' + x.id }); }));

// --- faction section ---
app.get('/api/faction/:id', H(async (q, r) => { if (!need(q, r)) return; const fid = +q.params.id;
  if (!F[fid] || !canView(q.u, fid)) return r.status(403).json({ error: 'Немає доступу до цієї фракції' });
  const secretOk = q.u.faction_id === fid ? q.u.rank >= 8 || q.u.role !== 'member' : isOverseer(q.u) || isAdmin(q.u);
  r.json({ faction: F[fid], canManage: canManage(q.u, fid), secretOk,
    roster: await db.all("SELECT id,login,name,static_id,rank,role,demo FROM users WHERE faction_id=? AND status='active' ORDER BY rank DESC,name", [fid]),
    docs: await db.all(`SELECT d.*,u.name author FROM docs d LEFT JOIN users u ON u.id=d.author_id WHERE d.faction_id=? AND d.to_faction_id IS NULL ${secretOk ? '' : "AND d.access<>'secret'"} ORDER BY d.id DESC LIMIT 100`, [fid]),
    complaints: await db.all('SELECT * FROM complaints WHERE faction_id=? ORDER BY id DESC LIMIT 50', [fid]),
    appointments: await db.all('SELECT * FROM appointments WHERE faction_id=? ORDER BY id DESC LIMIT 50', [fid]) });
}));
app.post('/api/faction/:id/doc', H(async (q, r) => { if (!need(q, r)) return; const fid = +q.params.id, b = q.body;
  if (q.u.faction_id !== fid && !isAdmin(q.u)) return r.status(403).json({ error: 'Документи створюють лише співробітники фракції' });
  const kind = ['doc', 'order', 'directive', 'news'].includes(b.kind) ? b.kind : 'doc', access = ['public', 'internal', 'secret'].includes(b.access) ? b.access : 'internal';
  if ((kind === 'order' || kind === 'directive') && !canManage(q.u, fid) && q.u.rank < 9) return r.status(403).json({ error: 'Накази та директиви видає керівництво (ранг 9+)' });
  if (!b.title) return r.status(400).json({ error: 'Вкажіть назву' });
  const x = await db.run('INSERT INTO docs(faction_id,kind,title,body,access,author_id,created_at) VALUES(?,?,?,?,?,?,?)', [fid, kind, String(b.title).slice(0, 200), String(b.body || '').slice(0, 20000), access, q.u.id, now()]);
  await audit(q.u.id, 'doc.create', `${F[fid].name}: ${b.title}`); r.json({ ok: 1, id: x.id }); }));
app.post('/api/faction/:id/status', H(async (q, r) => { if (!need(q, r)) return; const fid = +q.params.id, b = q.body;
  if (!canView(q.u, fid) || (q.u.faction_id !== fid && !isOverseer(q.u) && !isAdmin(q.u))) return r.status(403).json({ error: 'Немає доступу' });
  const t = b.type === 'appointment' ? 'appointments' : 'complaints';
  await db.run(`UPDATE ${t} SET status=? ${t === 'complaints' ? ',answer=?' : ''} WHERE id=? AND faction_id=?`, t === 'complaints' ? [String(b.status), String(b.answer || ''), +b.id, fid] : [String(b.status), +b.id, fid]);
  await audit(q.u.id, t + '.status', `${F[fid].name} #${b.id} → ${b.status}`); r.json({ ok: 1 }); }));
// roster management: hire / rank / fire
app.post('/api/faction/:id/member', H(async (q, r) => { if (!need(q, r)) return; const fid = +q.params.id, b = q.body;
  if (!canManage(q.u, fid)) return r.status(403).json({ error: 'Керувати складом може лідер фракції, Уряд або СБУ' });
  const ranks = F[fid].ranks.length;
  if (b.action === 'hire') {
    const login = String(b.login || '').trim().toLowerCase(); if (!/^[a-z0-9_.]{3,24}$/.test(login) || !b.name || String(b.password || '').length < 6) return r.status(400).json({ error: 'Логін (латиниця 3–24), імʼя і пароль від 6 символів' });
    const ex = await db.get('SELECT * FROM users WHERE login=?', [login]);
    const rank = Math.max(1, Math.min(ranks - 1, +b.rank || 1));
    if (ex && ex.status === 'active') return r.status(400).json({ error: 'Логін зайнятий' });
    if (ex) await db.run("UPDATE users SET pass_hash=?,name=?,static_id=?,faction_id=?,rank=?,role='member',status='active' WHERE id=?", [bcrypt.hashSync(b.password, 10), b.name, b.static_id || '', fid, rank, ex.id]);
    else await db.run('INSERT INTO users(login,pass_hash,name,static_id,faction_id,rank,created_at) VALUES(?,?,?,?,?,?,?)', [login, bcrypt.hashSync(b.password, 10), String(b.name).slice(0, 80), String(b.static_id || '').slice(0, 20), fid, rank, now()]);
    await audit(q.u.id, 'member.hire', `${F[fid].name}: ${b.name} (${login}), ранг ${rank}`); return r.json({ ok: 1 });
  }
  const m = await db.get("SELECT * FROM users WHERE id=? AND faction_id=? AND status='active'", [+b.user_id, fid]);
  if (!m) return r.status(404).json({ error: 'Співробітника не знайдено' });
  if (m.id === q.u.id) return r.status(400).json({ error: 'Не можна змінювати себе' });
  if (m.role === 'admin' && !isAdmin(q.u)) return r.status(403).json({ error: 'Це адміністратор порталу' });
  if (!isAdmin(q.u) && q.u.faction_id === fid && m.rank >= q.u.rank && q.u.role !== 'leader') return r.status(403).json({ error: 'Не можна керувати старшим або рівним за рангом' });
  if (m.role === 'leader' && !isAdmin(q.u) && !isOverseer(q.u)) return r.status(403).json({ error: 'Лідера знімає лише Уряд, СБУ або адмін' });
  if (b.action === 'rank') { const rank = Math.max(1, Math.min(ranks, +b.rank));
    await db.run('UPDATE users SET rank=?, role=? WHERE id=?', [rank, rank === ranks ? 'leader' : (m.role === 'leader' ? 'member' : m.role), m.id]);
    await audit(q.u.id, 'member.rank', `${F[fid].name}: ${m.name} ${m.rank} → ${rank}`); return r.json({ ok: 1 }); }
  if (b.action === 'fire') { const reason = String(b.reason || '').trim(); if (!reason) return r.status(400).json({ error: 'Вкажіть причину звільнення' });
    await db.run("UPDATE users SET status='fired' WHERE id=?", [m.id]); await db.run('DELETE FROM sessions WHERE user_id=?', [m.id]);
    const by = q.u.faction_id === fid ? 'керівництвом фракції' : `наглядом (${F[q.u.faction_id] ? F[q.u.faction_id].name : 'адмін'})`;
    await audit(q.u.id, 'member.fire', `${F[fid].name}: ${m.name} звільнено ${by}. Причина: ${reason}`); return r.json({ ok: 1 }); }
  r.status(400).json({ error: 'Невідома дія' });
}));

// --- shared government layer ---
app.get('/api/gov', H(async (q, r) => { if (!need(q, r)) return; const f = q.u.faction_id, all = isAdmin(q.u) || isOverseer(q.u);
  r.json({
    requests: await db.all(`SELECT q.*,u.name author FROM requests q LEFT JOIN users u ON u.id=q.author_id ${all ? '' : 'WHERE q.from_f=? OR q.to_f=?'} ORDER BY q.id DESC LIMIT 100`, all ? [] : [f, f]),
    exchange: await db.all(`SELECT d.*,u.name author FROM docs d LEFT JOIN users u ON u.id=d.author_id WHERE d.to_faction_id IS NOT NULL ${all ? '' : 'AND (d.faction_id=? OR d.to_faction_id=?)'} ORDER BY d.id DESC LIMIT 100`, all ? [] : [f, f]),
  }); }));
app.post('/api/gov/request', H(async (q, r) => { if (!need(q, r)) return; const b = q.body;
  if (!F[+b.to_f] || +b.to_f === q.u.faction_id || !b.title) return r.status(400).json({ error: 'Оберіть відомство-адресата і тему' });
  await db.run('INSERT INTO requests(from_f,to_f,title,body,author_id,created_at) VALUES(?,?,?,?,?,?)', [q.u.faction_id, +b.to_f, String(b.title).slice(0, 200), String(b.body || '').slice(0, 5000), q.u.id, now()]);
  await audit(q.u.id, 'request.create', `${F[q.u.faction_id].name} → ${F[+b.to_f].name}: ${b.title}`); r.json({ ok: 1 }); }));
app.post('/api/gov/request/:id', H(async (q, r) => { if (!need(q, r)) return; const x = await db.get('SELECT * FROM requests WHERE id=?', [+q.params.id]);
  if (!x || (x.to_f !== q.u.faction_id && !isAdmin(q.u) && !isOverseer(q.u))) return r.status(403).json({ error: 'Відповідає відомство-адресат' });
  await db.run('UPDATE requests SET status=?,answer=? WHERE id=?', [String(q.body.status || 'В роботі'), String(q.body.answer || ''), x.id]);
  await audit(q.u.id, 'request.answer', `#${x.id} → ${q.body.status}`); r.json({ ok: 1 }); }));
app.post('/api/gov/exchange', H(async (q, r) => { if (!need(q, r)) return; const b = q.body;
  if (!F[+b.to_f] || !b.title) return r.status(400).json({ error: 'Оберіть адресата і назву' });
  await db.run("INSERT INTO docs(faction_id,to_faction_id,kind,title,body,access,author_id,created_at) VALUES(?,?,'doc',?,?,?,?,?)", [q.u.faction_id, +b.to_f, String(b.title).slice(0, 200), String(b.body || '').slice(0, 20000), b.access === 'secret' ? 'secret' : 'internal', q.u.id, now()]);
  await audit(q.u.id, 'exchange.send', `${F[q.u.faction_id].name} → ${F[+b.to_f].name}: ${b.title}`); r.json({ ok: 1 }); }));
app.post('/api/wanted', H(async (q, r) => { if (!need(q, r)) return; const b = q.body;
  if (!['npu', 'obl', 'sbu', 'fib'].includes(F[q.u.faction_id] && F[q.u.faction_id].code) && !isAdmin(q.u)) return r.status(403).json({ error: 'Розшук ведуть НПУ, Обласна поліція, СБУ, FIB' });
  if (b.id) { await db.run('UPDATE wanted SET active=0 WHERE id=?', [+b.id]); await audit(q.u.id, 'wanted.close', '#' + b.id); return r.json({ ok: 1 }); }
  if (!b.name) return r.status(400).json({ error: 'Вкажіть імʼя' });
  await db.run('INSERT INTO wanted(faction_id,name,reason,level,created_at) VALUES(?,?,?,?,?)', [q.u.faction_id, String(b.name).slice(0, 80), String(b.reason || '').slice(0, 300), Math.max(1, Math.min(5, +b.level || 1)), now()]);
  await audit(q.u.id, 'wanted.add', b.name); r.json({ ok: 1 }); }));
// oversight dashboard (Уряд / СБУ)
app.get('/api/oversight', H(async (q, r) => { if (!need(q, r)) return;
  if (!isAdmin(q.u) && !(F[q.u.faction_id] && F[q.u.faction_id].overseer)) return r.status(403).json({ error: 'Нагляд доступний Уряду та СБУ' });
  r.json({ factions: await db.all("SELECT f.id,f.name,(SELECT COUNT(*) FROM users u WHERE u.faction_id=f.id AND u.status='active') members,(SELECT COUNT(*) FROM complaints c WHERE c.faction_id=f.id AND c.status='Нова') complaints,(SELECT COUNT(*) FROM requests x WHERE x.to_f=f.id AND x.status='Нова') requests FROM factions f ORDER BY f.sort"),
    log: await db.all("SELECT a.*,u.name who FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.action LIKE 'member.%' ORDER BY a.id DESC LIMIT 60") }); }));
// --- admin ---
app.get('/api/admin', H(async (q, r) => { if (!isAdmin(q.u)) return r.status(403).json({ error: 'Лише адміністратор порталу' });
  r.json({ users: await db.all('SELECT id,login,name,static_id,faction_id,rank,role,status,demo FROM users ORDER BY faction_id,rank DESC'), audit: await db.all('SELECT a.*,u.name who FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200') }); }));
app.post('/api/admin/user', H(async (q, r) => { if (!isAdmin(q.u)) return r.status(403).json({ error: 'Лише адміністратор' }); const b = q.body;
  const u = await db.get('SELECT * FROM users WHERE id=?', [+b.id]); if (!u) return r.status(404).json({ error: 'Немає' });
  const role = ['member', 'leader', 'admin'].includes(b.role) ? b.role : u.role, st = ['active', 'fired'].includes(b.status) ? b.status : u.status;
  await db.run('UPDATE users SET faction_id=?,rank=?,role=?,status=? WHERE id=?', [F[+b.faction_id] ? +b.faction_id : u.faction_id, Math.max(1, Math.min(12, +b.rank || u.rank)), role, st, u.id]);
  if (b.password) await db.run('UPDATE users SET pass_hash=? WHERE id=?', [bcrypt.hashSync(String(b.password), 10), u.id]);
  await audit(q.u.id, 'admin.user', `${u.login}: ф=${b.faction_id} р=${b.rank} роль=${role} статус=${st}`); r.json({ ok: 1 }); }));
app.post('/api/admin/faction', H(async (q, r) => { if (!isAdmin(q.u)) return r.status(403).json({ error: 'Лише адміністратор' }); const b = q.body;
  const ranks = Array.isArray(b.ranks) && b.ranks.length >= 3 ? JSON.stringify(b.ranks.map(String).slice(0, 15)) : null;
  if (b.id) await db.run('UPDATE factions SET name=?,descr=?,overseer=?,ranks=? WHERE id=?', [b.name, b.descr || '', b.overseer ? 1 : 0, ranks, +b.id]);
  else { if (!b.code || !b.name) return r.status(400).json({ error: 'Код і назва' }); await db.run('INSERT INTO factions(code,name,descr,overseer,sort,ranks) VALUES(?,?,?,?,?,?)', [b.code, b.name, b.descr || '', b.overseer ? 1 : 0, 99, ranks]); }
  await loadF(); await audit(q.u.id, 'admin.faction', b.name); r.json({ ok: 1 }); }));
app.get('*', (q, r) => r.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

async function seed() {
  for (const f of DEFAULT_FACTIONS) await db.run(`INSERT INTO factions(code,name,descr,overseer,sort) VALUES(?,?,?,?,?) ${db.isPg ? 'ON CONFLICT(code) DO NOTHING' : 'ON CONFLICT(code) DO NOTHING'}`, [f.code, f.name, f.descr, f.overseer, f.sort]);
  await loadF();
  const byCode = c => Object.values(F).find(f => f.code === c).id;
  if (process.env.ADMIN_LOGIN && process.env.ADMIN_PASSWORD && !(await db.get('SELECT id FROM users WHERE login=?', [process.env.ADMIN_LOGIN])))
    await db.run("INSERT INTO users(login,pass_hash,name,faction_id,rank,role,created_at) VALUES(?,?,?,?,12,'admin',?)", [process.env.ADMIN_LOGIN, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10), process.env.ADMIN_NAME || 'Адміністратор', byCode('gov'), now()]);
  if (process.env.SEED_DEMO === '0' || (await db.get('SELECT id FROM users WHERE demo=1'))) return;
  const pw = bcrypt.hashSync('demo1234', 10), U = {};
  const add = async (login, name, code, rank, role = 'member') => { U[login] = (await db.run('INSERT INTO users(login,pass_hash,name,static_id,faction_id,rank,role,demo,created_at) VALUES(?,?,?,?,?,?,?,1,?)', [login, pw, name, String(1000 + Object.keys(U).length * 37), byCode(code), rank, role, now()])).id; };
  await add('demo_admin', '[Приклад] Адмін порталу', 'gov', 12, 'admin');
  await add('demo_gov', '[Приклад] Олена Коваль — мер', 'gov', 12, 'leader'); await add('demo_sbu', '[Приклад] Тарас Мельник — голова СБУ', 'sbu', 12, 'leader');
  await add('demo_npu_lead', '[Приклад] Андрій Бондар — начальник НПУ', 'npu', 12, 'leader'); await add('demo_npu', '[Приклад] Ігор Савчук', 'npu', 4); await add('demo_npu2', '[Приклад] Марія Лисенко', 'npu', 2);
  await add('demo_moz', '[Приклад] Дмитро Ткач', 'moz', 6); await add('demo_dsns', '[Приклад] Роман Гнатюк', 'dsns', 5);
  const d = (fid, kind, title, body, access, a, to) => db.run('INSERT INTO docs(faction_id,to_faction_id,kind,title,body,access,author_id,demo,created_at) VALUES(?,?,?,?,?,?,?,1,?)', [byCode(fid), to ? byCode(to) : null, kind, title, body, access, U[a], now()]);
  await d('gov', 'news', '[Приклад] Відкрито прийом громадян у Мерії', 'Щосереди з 18:00 керівництво міста приймає громадян. Записуйтесь через форму на порталі.', 'public', 'demo_gov');
  await d('npu', 'news', '[Приклад] НПУ оголошує набір патрульних', 'Шукаємо відповідальних громадян від 18 років (у грі). Подайте заявку на запис до НПУ.', 'public', 'demo_npu_lead');
  await d('gov', 'order', '[Приклад] Наказ №1 про посилення патрулювання', 'Доручити НПУ та Обласній поліції посилити патрулювання у нічний час.', 'public', 'demo_gov');
  await d('npu', 'directive', '[Приклад] Директива щодо бодікамер', 'Усім патрульним вмикати бодікамери під час затримань.', 'internal', 'demo_npu_lead');
  await d('sbu', 'doc', '[Приклад] Оперативна довідка', 'Цілком таємно. Матеріал для СБУ.', 'secret', 'demo_sbu');
  await d('npu', 'doc', '[Приклад] Рапорт про ДТП', 'Рапорт патрульного щодо ДТП на перехресті.', 'internal', 'demo_npu');
  await d('npu', 'doc', '[Приклад] Протокол передачі затриманого', 'Передача затриманого до слідчого СБУ.', 'internal', 'demo_npu_lead', 'sbu');
  await db.run('INSERT INTO requests(from_f,to_f,title,body,author_id,demo,created_at) VALUES(?,?,?,?,?,1,?)', [byCode('npu'), byCode('moz'), '[Приклад] Медпідтримка на масовому заході', 'Просимо виділити 2 бригади на суботній концерт.', U.demo_npu_lead, now()]);
  await db.run('INSERT INTO requests(from_f,to_f,title,body,author_id,demo,created_at) VALUES(?,?,?,?,?,1,?)', [byCode('sbu'), byCode('npu'), '[Приклад] Запит на матеріали справи', 'Надати матеріали по викраденню авто.', U.demo_sbu, now()]);
  await db.run('INSERT INTO wanted(faction_id,name,reason,level,demo,created_at) VALUES(?,?,?,?,1,?)', [byCode('npu'), '[Приклад] John Doe', 'Збройне пограбування АТБ', 4, now()]);
  await db.run('INSERT INTO wanted(faction_id,name,reason,level,demo,created_at) VALUES(?,?,?,?,1,?)', [byCode('npu'), '[Приклад] Vasyl Kit', 'Викрадення транспорту', 2, now()]);
  await db.run('INSERT INTO complaints(faction_id,name,contact,body,demo,created_at) VALUES(?,?,?,?,1,?)', [byCode('npu'), '[Приклад] Громадянин', 'Discord: citizen', 'Патрульний не представився під час зупинки.', now()]);
  await db.run('INSERT INTO appointments(faction_id,name,contact,topic,demo,created_at) VALUES(?,?,?,?,1,?)', [byCode('gov'), '[Приклад] Петро', 'тел. 555-0101', 'Питання щодо ліцензії на бізнес', now()]);
}
(async () => { await db.init(SCHEMA, 'state.db'); await seed(); const port = process.env.PORT || 3100; app.listen(port, () => console.log('Державний портал: http://localhost:' + port)); })();
