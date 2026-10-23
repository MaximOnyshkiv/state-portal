const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = t => new Date(+t).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
const api = async (u, b) => { const r = await fetch(u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Помилка'); return j; };
const toast = m => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = m; document.body.append(d); setTimeout(() => d.remove(), 2600); };
const form = el => Object.fromEntries(new FormData(el));
let ME = {}, FN = {};
const fname = id => FN[id] ? FN[id].name : '—';
const KIND = { doc: 'Документ', order: 'Наказ', directive: 'Директива', news: 'Новина' }, ACC = { public: 'Публічний', internal: 'Службовий', secret: 'Таємно' };
const rankName = (fid, r) => (FN[fid] && FN[fid].ranks[r - 1]) || ('Ранг ' + r);
const roleTag = u => u.role === 'admin' ? '<span class="tag y">Адмін</span>' : u.role === 'leader' ? '<span class="tag y">Лідер</span>' : '<span class="tag">Співробітник</span>';
const fopts = (sel, excl) => Object.values(FN).filter(f => f.id !== excl).map(f => `<option value="${f.id}" ${f.id == sel ? 'selected' : ''}>${esc(f.name)}</option>`).join('');

function chrome() {
  const u = ME.user, h = location.hash;
  $('#links').innerHTML = `<a href="#/" class="${h === '#/' || !h ? 'on' : ''}">Громадянам</a><a href="#/#wanted">Розшук</a><a href="#/#appeal">Звернення</a>` + (u ? `<a class="acc" href="#/f/${u.faction_id}">Кабінет</a>` : `<a class="acc" href="#/login">Вхід для службовців</a>`);
  $('#ws').hidden = !u; if (!u) return;
  const L = [[`#/f/${u.faction_id}`, 'Моя фракція'], ['#/gov', 'Міжвідомча взаємодія']];
  if (ME.overseerView || ME.admin) L.push(['#/oversight', 'Нагляд']);
  if (ME.admin) L.push(['#/admin', 'Адмінпанель']);
  $('#wsin').innerHTML = `<span class="eb">${esc(fname(u.faction_id))}</span>` + L.map(([a, t]) => `<a href="${a}" class="${h.startsWith(a) ? 'on' : ''}">${t}</a>`).join('') +
    `<span class="who">${esc(u.name)} · ${esc(rankName(u.faction_id, u.rank))} ${roleTag(u)} <button class="btn gh sm" onclick="logout()">Вийти</button></span>`;
}
async function logout() { await api('/api/logout', {}); await boot(); location.hash = '#/'; }

async function pagePublic() {
  const p = await api('/api/public'), st = Object.fromEntries(p.stats.map(s => [s.faction_id, s.n]));
  app.innerHTML = `<section class="hero"><div><div class="veb">Портал для громадян</div><h1 class="vh">Держава поруч — <br>прозоро та онлайн</h1><div class="flag"></div>
   <p class="sub">Новини державних органів, офіційні накази, список розшуку, звернення та запис на прийом — в одному місці. Службовці входять у свій кабінет.</p>
   <p><a class="btn" href="#appeal" onclick="event.preventDefault();document.getElementById('appeal').scrollIntoView()">Подати звернення</a> <a class="btn gh" href="#/login">Кабінет службовця</a></p></div>
   <div class="card"><h3>Державні органи</h3>${Object.values(FN).map(f => `<div class="it"><b>${esc(f.name)}</b> ${f.overseer ? '<span class="tag b">Нагляд</span>' : ''}<div class="meta">${esc(f.descr || '')} · ${st[f.id] || 0} співробітників</div></div>`).join('')}</div></section>
  <div class="grid g2"><div class="card"><h3>Новини</h3>${p.news.map(n => `<div class="it"><span class="tag">${esc(fname(n.faction_id))}</span> <b>${esc(n.title)}</b><div class="sub">${esc(n.body)}</div><div class="meta">${dt(n.created_at)}</div></div>`).join('') || '<div class="meta">Поки немає</div>'}</div>
   <div class="card"><h3>Офіційні накази та директиви</h3>${p.orders.map(n => `<div class="it"><span class="tag y">${KIND[n.kind]}</span> <b>${esc(n.title)}</b><div class="meta">${esc(fname(n.faction_id))} · ${dt(n.created_at)}</div></div>`).join('') || '<div class="meta">Поки немає</div>'}</div></div>
  <div class="card" id="wanted" style="margin-top:18px"><h3>Розшук</h3><table><tr><th>Особа</th><th>Підстава</th><th>Рівень</th><th>Орган</th></tr>${p.wanted.map(w => `<tr><td><b>${esc(w.name)}</b></td><td>${esc(w.reason)}</td><td class="lvl">${'★'.repeat(w.level)}</td><td>${esc(fname(w.faction_id))}</td></tr>`).join('')}</table></div>
  <div class="grid g2" id="appeal" style="margin-top:18px"><form class="card" id="fc"><h3>Скарга / звернення</h3><label>Орган</label><select name="faction_id">${fopts()}</select><label>Ваше імʼя (у грі)</label><input name="name" required><label>Контакт</label><input name="contact" placeholder="Discord / телефон у грі"><label>Текст</label><textarea name="body" required></textarea><button class="btn">Надіслати</button></form>
   <form class="card" id="fa"><h3>Запис на прийом</h3><label>Орган</label><select name="faction_id">${fopts()}</select><label>Ваше імʼя</label><input name="name" required><label>Контакт</label><input name="contact"><label>Тема</label><textarea name="topic" required></textarea><button class="btn">Записатися</button></form></div>`;
  $('#fc').onsubmit = async e => { e.preventDefault(); try { const r = await api('/api/public/complaint', form(e.target)); e.target.reset(); toast('Прийнято, номер ' + r.no); } catch (x) { toast(x.message); } };
  $('#fa').onsubmit = async e => { e.preventDefault(); try { const r = await api('/api/public/appointment', form(e.target)); e.target.reset(); toast('Записано, номер ' + r.no); } catch (x) { toast(x.message); } };
}
async function pageLogin() {
  let m = { nova: false, local: true }; try { m = await (await fetch('/api/auth/mode')).json(); } catch {}
  const done = async () => { await boot(); location.hash = '#/f/' + ME.user.faction_id; };
  const game = `<form class="card login" id="gf"><div class="veb">Кабінет службовця</div><h1 class="vh" style="font-size:28px">Вхід через NovaRP</h1><label>Ігровий логін</label><input name="login" autocomplete="username" required><label>Пароль від гри</label><input name="password" type="password" autocomplete="current-password" required><button class="btn" style="width:100%">Увійти</button><div class="hint">Доступ і ранг підтягуються з гри автоматично при кожному вході.</div></form>`;
  const local = `<form class="card login" id="lf" ${m.nova ? 'style="margin-top:18px"' : ''}><div class="veb">${m.nova ? 'Службовий вхід' : 'Кабінет службовця'}</div><h1 class="vh" style="font-size:${m.nova ? 20 : 28}px">${m.nova ? 'Локальний акаунт' : 'Вхід'}</h1><label>Логін</label><input name="login" autocomplete="username"><label>Пароль</label><input name="password" type="password"><button class="btn ${m.nova ? 'gh' : ''}" style="width:100%">Увійти</button>${m.nova ? '' : '<div class="hint">Демо: demo_gov, demo_sbu, demo_npu_lead, demo_npu, demo_admin — пароль demo1234.</div>'}</form>`;
  app.innerHTML = (m.nova ? game : '') + (m.local || !m.nova ? local : `<details style="max-width:420px;margin:14px auto"><summary class="meta">Службовий вхід</summary>${local}</details>`);
  $('#lf').onsubmit = async e => { e.preventDefault(); try { await api('/api/login', form(e.target)); await done(); } catch (x) { toast(x.message); } };
  if (m.nova) $('#gf').onsubmit = async e => { e.preventDefault(); try { const r = await api('/api/login/game', form(e.target));
    if (!r.choose) return await done();
    app.innerHTML = `<div class="card login"><div class="veb">Кілька персонажів</div><h1 class="vh" style="font-size:24px">Оберіть персонажа</h1>${r.choose.map(c => `<button class="btn gh" style="width:100%;margin:6px 0" data-id="${c.id}">${esc(c.name)} · ${esc(c.faction)} · ранг ${c.rank}</button>`).join('')}</div>`;
    app.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => { try { await api('/api/login/char', { ticket: r.ticket, char_id: +b.dataset.id }); await done(); } catch (x) { toast(x.message); pageLogin(); } });
  } catch (x) { toast(x.message); } };
}
let ftab = 'roster';
async function pageFaction(fid) {
  const d = await api('/api/faction/' + fid), f = d.faction, mine = ME.user.faction_id === fid;
  const T = [['roster', 'Склад'], ['docs', 'Документи'], ['kanc', 'Канцелярія'], ['citizens', 'Звернення громадян']];
  const docs = d.docs.filter(x => x.kind === 'doc'), kanc = d.docs.filter(x => x.kind !== 'doc');
  const docList = L => L.map(x => `<div class="it"><span class="tag">${KIND[x.kind]}</span> <span class="tag ${x.access}">${ACC[x.access]}</span> <b>${esc(x.title)}</b><div class="sub" style="white-space:pre-wrap">${esc(x.body)}</div><div class="meta">${esc(x.author || '')} · ${dt(x.created_at)}</div></div>`).join('') || '<div class="meta">Порожньо</div>';
  const docForm = kinds => mine || ME.admin ? `<form class="card" id="df"><h3>Створити</h3><label>Тип</label><select name="kind">${kinds.map(k => `<option value="${k}">${KIND[k]}</option>`).join('')}</select><label>Доступ</label><select name="access"><option value="internal">Службовий</option><option value="public">Публічний (видно громадянам)</option>${d.secretOk ? '<option value="secret">Таємно</option>' : ''}</select><label>Назва</label><input name="title" required><label>Текст</label><textarea name="body"></textarea><button class="btn">Зберегти</button></form>` : '<div class="card"><h3>Режим нагляду</h3><div class="sub">Ви переглядаєте фракцію як нагляд. Документи створюють її співробітники.</div></div>';
  let body = '';
  if (ftab === 'roster') body = `<div class="card"><h3>Склад · ${d.roster.length}</h3><table><tr><th>Співробітник</th><th>Static</th><th>Ранг</th><th>Роль</th>${d.canManage ? '<th>Дії</th>' : ''}</tr>${d.roster.map(m => `<tr><td><b>${esc(m.name)}</b><div class="meta">${esc(m.login)}</div></td><td>${esc(m.static_id)}</td><td>${m.rank} · ${esc(rankName(fid, m.rank))}</td><td>${roleTag(m)}</td>${d.canManage ? `<td>${m.id === ME.user.id ? '' : `<select style="width:auto;margin:0" onchange="mem(${fid},{action:'rank',user_id:${m.id},rank:this.value})">${f.ranks.map((r, i) => `<option value="${i + 1}" ${i + 1 === m.rank ? 'selected' : ''}>${i + 1}</option>`).join('')}</select> <button class="btn red sm" onclick="fire(${fid},${m.id},'${esc(m.name).replace(/'/g, '')}')">Звільнити</button>`}</td>` : ''}</tr>`).join('')}</table></div>` +
    (d.canManage ? `<form class="card" id="hf" style="margin-top:18px"><h3>Прийняти на службу</h3><div class="grid g4"><div><label>Логін</label><input name="login" required></div><div><label>Імʼя Прізвище</label><input name="name" required></div><div><label>Static ID</label><input name="static_id"></div><div><label>Початковий пароль</label><input name="password" required></div></div><label>Ранг</label><select name="rank">${f.ranks.slice(0, -1).map((r, i) => `<option value="${i + 1}">${i + 1} · ${esc(r)}</option>`).join('')}</select><button class="btn">Прийняти</button>${!mine ? '<div class="hint">Дію буде записано в журнал нагляду.</div>' : ''}</form>` : '');
  if (ftab === 'docs') body = `<div class="grid g2"><div class="card"><h3>Документи фракції</h3>${docList(docs)}</div>${docForm(['doc'])}</div>`;
  if (ftab === 'kanc') body = `<div class="grid g2"><div class="card"><h3>Накази, директиви, новини</h3>${docList(kanc)}</div>${docForm(['order', 'directive', 'news'])}</div>`;
  if (ftab === 'citizens') body = `<div class="grid g2"><div class="card"><h3>Скарги</h3>${d.complaints.map(c => `<div class="it"><span class="tag">СК-${c.id}</span> <span class="tag y">${esc(c.status)}</span> <b>${esc(c.name)}</b> <span class="meta">${esc(c.contact)}</span><div class="sub">${esc(c.body)}</div>${c.answer ? `<div class="meta">Відповідь: ${esc(c.answer)}</div>` : ''}<button class="btn gh sm" onclick="st(${fid},'complaint',${c.id})">Відповісти / статус</button></div>`).join('') || '<div class="meta">Немає</div>'}</div>
    <div class="card"><h3>Запис на прийом</h3>${d.appointments.map(c => `<div class="it"><span class="tag">ЗП-${c.id}</span> <span class="tag y">${esc(c.status)}</span> <b>${esc(c.name)}</b> <span class="meta">${esc(c.contact)}</span><div class="sub">${esc(c.topic)}</div><button class="btn gh sm" onclick="st(${fid},'appointment',${c.id})">Змінити статус</button></div>`).join('') || '<div class="meta">Немає</div>'}</div></div>`;
  app.innerHTML = `<div class="veb">${mine ? 'Моя фракція' : 'Нагляд · перегляд фракції'}</div><h1 class="vh">${esc(f.name)}</h1><p class="sub">${esc(f.descr || '')}</p>
   <div class="tabs">${T.map(([k, t]) => `<button class="tab ${ftab === k ? 'on' : ''}" onclick="ftab='${k}';route()">${t}</button>`).join('')}</div>${body}`;
  const df = $('#df'); if (df) df.onsubmit = async e => { e.preventDefault(); try { await api(`/api/faction/${fid}/doc`, form(e.target)); toast('Збережено'); route(); } catch (x) { toast(x.message); } };
  const hf = $('#hf'); if (hf) hf.onsubmit = async e => { e.preventDefault(); try { await api(`/api/faction/${fid}/member`, { action: 'hire', ...form(e.target) }); toast('Прийнято на службу'); route(); } catch (x) { toast(x.message); } };
}
async function mem(fid, b) { try { await api(`/api/faction/${fid}/member`, b); toast('Готово'); route(); } catch (x) { toast(x.message); route(); } }
function fire(fid, id, n) { const reason = prompt('Причина звільнення: ' + n); if (reason) mem(fid, { action: 'fire', user_id: id, reason }); }
async function st(fid, type, id) { const status = prompt('Новий статус (напр.: В роботі, Розглянуто, Відхилено, Підтверджено)', 'Розглянуто'); if (!status) return; const answer = type === 'complaint' ? prompt('Відповідь громадянину', '') : ''; try { await api(`/api/faction/${fid}/status`, { type, id, status, answer }); route(); } catch (x) { toast(x.message); } }

async function pageGov() {
  const d = await api('/api/gov'), my = ME.user.faction_id, police = ['npu', 'obl', 'sbu', 'fib'].includes(FN[my].code) || ME.admin;
  app.innerHTML = `<div class="veb">Спільний державний рівень</div><h1 class="vh">Міжвідомча взаємодія</h1><p class="sub">Запити між відомствами та обмін документами. Кожна фракція бачить лише своє листування; Уряд і СБУ — все.</p>
  <div class="grid g2" style="margin-top:22px"><div class="card"><h3>Міжвідомчі запити</h3>${d.requests.map(x => `<div class="it"><span class="tag b">${esc(fname(x.from_f))} → ${esc(fname(x.to_f))}</span> <span class="tag y">${esc(x.status)}</span><br><b>${esc(x.title)}</b><div class="sub">${esc(x.body)}</div>${x.answer ? `<div class="meta">Відповідь: ${esc(x.answer)}</div>` : ''}<div class="meta">${esc(x.author || '')} · ${dt(x.created_at)}</div>${x.to_f === my || ME.overseer || ME.admin ? `<button class="btn gh sm" onclick="ans(${x.id})">Відповісти</button>` : ''}</div>`).join('') || '<div class="meta">Немає</div>'}</div>
   <form class="card" id="rf"><h3>Новий запит</h3><label>Кому</label><select name="to_f">${fopts(null, my)}</select><label>Тема</label><input name="title" required><label>Суть</label><textarea name="body"></textarea><button class="btn">Надіслати запит</button></form>
   <div class="card"><h3>Обмін документами</h3>${d.exchange.map(x => `<div class="it"><span class="tag b">${esc(fname(x.faction_id))} → ${esc(fname(x.to_faction_id))}</span> <span class="tag ${x.access}">${ACC[x.access]}</span><br><b>${esc(x.title)}</b><div class="sub" style="white-space:pre-wrap">${esc(x.body)}</div><div class="meta">${esc(x.author || '')} · ${dt(x.created_at)}</div></div>`).join('') || '<div class="meta">Немає</div>'}</div>
   <form class="card" id="xf"><h3>Передати документ</h3><label>Кому</label><select name="to_f">${fopts(null, my)}</select><label>Гриф</label><select name="access"><option value="internal">Службовий</option><option value="secret">Таємно</option></select><label>Назва</label><input name="title" required><label>Текст</label><textarea name="body"></textarea><button class="btn">Передати</button></form>
   ${police ? `<form class="card" id="wf"><h3>Оголосити в розшук</h3><label>Особа</label><input name="name" required><label>Підстава</label><input name="reason"><label>Рівень (1–5)</label><input name="level" type="number" min="1" max="5" value="1"><button class="btn">Оголосити</button><div class="hint">Список видно громадянам на головній. Зняти з розшуку — нижче.</div><div id="wl"></div></form>` : ''}</div>`;
  $('#rf').onsubmit = async e => { e.preventDefault(); try { await api('/api/gov/request', form(e.target)); toast('Запит надіслано'); route(); } catch (x) { toast(x.message); } };
  $('#xf').onsubmit = async e => { e.preventDefault(); try { await api('/api/gov/exchange', form(e.target)); toast('Документ передано'); route(); } catch (x) { toast(x.message); } };
  if (police) { const p = await api('/api/public'); $('#wl').innerHTML = p.wanted.map(w => `<div class="it"><b>${esc(w.name)}</b> <span class="lvl">${'★'.repeat(w.level)}</span> <button type="button" class="btn gh sm" onclick="api('/api/wanted',{id:${w.id}}).then(route)">Зняти</button></div>`).join('');
    $('#wf').onsubmit = async e => { e.preventDefault(); try { await api('/api/wanted', form(e.target)); toast('Додано'); route(); } catch (x) { toast(x.message); } }; }
}
async function ans(id) { const status = prompt('Статус: В роботі / Виконано / Відхилено', 'В роботі'); if (!status) return; const answer = prompt('Відповідь', '') || ''; try { await api('/api/gov/request/' + id, { status, answer }); route(); } catch (x) { toast(x.message); } }

async function pageOversight() {
  const d = await api('/api/oversight');
  app.innerHTML = `<div class="veb">Уряд · СБУ</div><h1 class="vh">Нагляд за державними фракціями</h1><p class="sub">Уряд і СБУ бачать кожну державну фракцію, можуть приймати, підвищувати та звільняти її співробітників. Кожна дія записується в журнал.</p>
   <div class="grid g3" style="margin-top:22px">${d.factions.map(f => `<a class="card" href="#/f/${f.id}"><h4>${esc(f.name)}</h4><div class="meta">${f.members} співробітників</div><div style="margin-top:10px"><span class="tag ${f.complaints ? 'secret' : ''}">Нові скарги: ${f.complaints}</span> <span class="tag b">Запити: ${f.requests}</span></div></a>`).join('')}</div>
   <div class="card" style="margin-top:18px"><h3>Журнал кадрових рішень</h3>${d.log.map(a => `<div class="it"><span class="tag ${a.action === 'member.fire' ? 'secret' : 'y'}">${{ 'member.fire': 'Звільнення', 'member.hire': 'Прийом', 'member.rank': 'Ранг' }[a.action]}</span> ${esc(a.details)}<div class="meta">${esc(a.who || '')} · ${dt(a.created_at)}</div></div>`).join('') || '<div class="meta">Порожньо</div>'}</div>`;
}
async function pageAdmin() {
  const d = await api('/api/admin');
  app.innerHTML = `<div class="veb">Адміністрування</div><h1 class="vh">Адмінпанель порталу</h1>
  <div class="card" style="margin-top:22px"><h3>Користувачі · ${d.users.length}</h3><table><tr><th>Користувач</th><th>Фракція</th><th>Ранг</th><th>Роль</th><th>Статус</th><th></th></tr>${d.users.map(u => `<tr id="u${u.id}"><td><b>${esc(u.name)}</b><div class="meta">${esc(u.login)}</div></td><td><select name="faction_id">${fopts(u.faction_id)}</select></td><td><input name="rank" type="number" min="1" max="12" value="${u.rank}" style="width:70px"></td><td><select name="role">${['member', 'leader', 'admin'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td><select name="status">${['active', 'fired'].map(r => `<option ${r === u.status ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td><button class="btn sm" onclick="saveU(${u.id})">Зберегти</button></td></tr>`).join('')}</table></div>
  <div class="grid g2" style="margin-top:18px"><form class="card" id="ff"><h3>Фракції (додати / змінити)</h3><label>Фракція</label><select name="id"><option value="">+ Нова</option>${fopts()}</select><label>Код (для нової)</label><input name="code"><label>Назва</label><input name="name"><label>Опис</label><input name="descr"><label>Ранги через кому (порожньо = стандартні 12)</label><input name="ranks"><label><input type="checkbox" name="overseer" style="width:auto"> Наглядовий орган (як Уряд/СБУ)</label><br><button class="btn">Зберегти фракцію</button></form>
  <div class="card"><h3>Журнал дій</h3><div style="max-height:520px;overflow:auto">${d.audit.map(a => `<div class="it"><span class="tag">${esc(a.action)}</span> ${esc(a.details)}<div class="meta">${esc(a.who || '')} · ${dt(a.created_at)}</div></div>`).join('')}</div></div></div>`;
  $('#ff').onsubmit = async e => { e.preventDefault(); const b = form(e.target); b.ranks = b.ranks ? b.ranks.split(',').map(s => s.trim()).filter(Boolean) : null; b.overseer = !!b.overseer; if (b.id && !b.name) b.name = FN[b.id].name; try { await api('/api/admin/faction', b); await boot(); toast('Збережено'); route(); } catch (x) { toast(x.message); } };
}
async function saveU(id) { const r = $('#u' + id), b = { id }; r.querySelectorAll('[name]').forEach(i => b[i.name] = i.value); try { await api('/api/admin/user', b); toast('Збережено'); } catch (x) { toast(x.message); } }

async function route() {
  const h = location.hash.replace(/#[a-z]+$/, '') || '#/'; chrome();
  try {
    if (h === '#/login') return pageLogin();
    if (h.startsWith('#/') && h.length > 2 && !ME.user) { location.hash = '#/login'; return; }
    let m; if ((m = h.match(/^#\/f\/(\d+)/))) return await pageFaction(+m[1]);
    if (h === '#/gov') return await pageGov(); if (h === '#/oversight') return await pageOversight(); if (h === '#/admin') return await pageAdmin();
    await pagePublic(); if (location.hash.includes('#wanted') || location.hash.includes('#appeal')) document.getElementById(location.hash.split('#').pop())?.scrollIntoView();
  } catch (x) { app.innerHTML = `<div class="card"><h3>Немає доступу</h3><div class="sub">${esc(x.message)}</div></div>`; }
}
async function boot() { ME = await api('/api/me'); FN = Object.fromEntries(ME.factions.map(f => [f.id, f])); }
window.onhashchange = () => { ftab = 'roster'; route(); };
boot().then(route);
