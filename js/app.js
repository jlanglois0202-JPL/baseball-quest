import {
  CATEGORIES, XP_PER_DRILL, XP_PER_DAY, XP_PERFECT_BONUS,
  addDays, levelInfo, localISO, mondayOf, rankBoard, streak, totalXP, weekDates,
} from './game.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const api = DEMO ? await import('./mock.js') : await import('./api.js');

const AVATARS = ['⚾', '🧢', '🔥', '⚡', '🦅', '🐐', '💪', '🚀', '🐯', '🦈', '🐻', '⭐'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MAX_PROOF_MB = 25;
const MAX_DRILL_MB = 100;

const state = { session: null, profile: null, players: [], recovery: false, linkError: null };
const app = document.getElementById('app');
const dialog = document.getElementById('modal');

// ---------- small helpers ----------

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => localISO();
const prettyDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const longDate = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function openModal(html) {
  dialog.innerHTML = `<div class="modal">${html}</div>`;
  if (!dialog.open) dialog.showModal();
}

function closeModal() {
  if (dialog.open) dialog.close();
  dialog.querySelectorAll('video').forEach(v => v.pause());
}

dialog.addEventListener('click', e => { if (e.target === dialog) closeModal(); });

function showError(form, err) {
  let box = form.querySelector('.error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'error';
    form.appendChild(box);
  }
  box.textContent = err.message || String(err);
}

async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function loading() {
  app.innerHTML = '<div class="spinner" aria-label="Loading"></div>';
}

function demoBar() {
  if (!DEMO) return '';
  const role = api.demoRole();
  return `<div class="demo"><b>DEMO</b> sample data, nothing is saved online
    <button data-act="demo-role" data-role="parent" class="${role === 'parent' ? 'on' : ''}">Player view</button>
    <button data-act="demo-role" data-role="coach" class="${role === 'coach' ? 'on' : ''}">Coach view</button>
    <button data-act="demo-reset">Reset</button></div>`;
}

function topbar(right = '') {
  return `<div class="topbar"><a class="brand" href="#/">BASEBALL <span>QUEST</span></a><div class="row">${right}</div></div>`;
}

function page(inner, nav = '') {
  app.innerHTML = `${demoBar()}<div class="wrap">${inner}</div>${nav}`;
  window.scrollTo(0, 0);
}

function coachNav(active) {
  const items = [['coach', '👥', 'PLAYERS'], ['coach/plans', '📋', 'PLANS'], ['coach/drills', '⚾', 'DRILLS'], ['coach/review', '🎥', 'REVIEW'], ['coach/teams', '🏟️', 'TEAMS']];
  return `<nav class="bottom"><div class="bottomin">${items.map(([r, i, l]) =>
    `<a class="nav ${active === r ? 'active' : ''}" href="#/${r}">${i}<br>${l}</a>`).join('')}</div></nav>`;
}

function daysDots(dayIsos, monday) {
  const set = new Set(dayIsos);
  return `<span class="mini-days">${weekDates(monday).map(d => `<i class="${set.has(d) ? 'on' : ''}"></i>`).join('')}</span>`;
}

function videoBlock(src) {
  return src ? `<video src="${esc(src)}" controls playsinline preload="metadata"></video>` : '';
}

function safeLink(url) {
  return /^https?:\/\//i.test(url || '') ? url : null;
}

// ---------- routing ----------

const routes = [
  [/^#\/login$/, loginPage, false],
  [/^#\/signup$/, signupPage, false],
  [/^#\/forgot$/, forgotPage, false],
  [/^#\/check-email$/, checkEmailPage, false],
  [/^#\/new-password$/, newPasswordPage, true],
  [/^#\/add-player$/, addPlayerPage, true],
  [/^#\/p\/([\w-]+)$/, playerPage, true],
  [/^#\/coach$/, coachPlayersPage, true],
  [/^#\/coach\/plans$/, coachPlansPage, true],
  [/^#\/coach\/drills$/, coachDrillsPage, true],
  [/^#\/coach\/review$/, coachReviewPage, true],
  [/^#\/coach\/teams$/, coachTeamsPage, true],
];

async function route() {
  closeModal();
  const hash = location.hash || '#/';
  if (state.recovery && hash !== '#/new-password') {
    location.hash = '#/new-password';
    return;
  }
  for (const [re, fn, needsAuth] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    if (needsAuth && !state.session) {
      location.hash = '#/login';
      return;
    }
    return run(fn, ...m.slice(1));
  }
  if (!state.session) {
    location.hash = '#/login';
    return;
  }
  return run(homePage);
}

async function run(fn, ...args) {
  loading();
  try {
    await fn(...args);
  } catch (err) {
    console.error(err);
    page(`${topbar()}<div class="card"><h3>Something went wrong</h3><p class="muted">${esc(err.message)}</p>
      <a class="btn" href="#/">Back to start</a></div>`);
  }
}

async function loadProfile() {
  state.profile = await api.getProfile();
  state.players = state.profile.role === 'coach' ? [] : await api.listMyPlayers();
}

window.addEventListener('hashchange', route);

// ---------- auth pages ----------

function authShell(inner) {
  page(`${topbar()}<div class="auth">${inner}</div>`);
}

function loginPage() {
  if (state.session) { location.hash = '#/'; return; }
  const linkError = state.linkError;
  state.linkError = null;
  authShell(`
    <section class="hero"><div class="eyebrow">Lugnuts offseason</div><h1>Welcome back</h1>
      <div class="sub">Log in to see this week's quests.</div></section>
    <form class="card" data-form="login">
      ${linkError ? `<div class="error">${esc(linkError)}</div>` : ''}
      <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="btn-primary" type="submit">LOG IN</button>
      <p class="center small"><a href="#/forgot">Forgot password?</a></p>
    </form>
    <p class="center sub">New here? <a href="#/signup">Create a parent account</a></p>
    <p class="center small muted">Just looking? <a href="?demo#/">Try the demo</a></p>`);
}

function signupPage() {
  authShell(`
    <section class="hero"><div class="eyebrow">For parents &amp; guardians</div><h1>Create an account</h1>
      <div class="sub">You'll add your player after you sign up. Coaches use this same form.</div></section>
    <form class="card" data-form="signup">
      <label for="fullName">Your name</label><input id="fullName" name="fullName" autocomplete="name" required maxlength="60">
      <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Password (8+ characters)</label><input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required>
      <label class="checkline"><input type="checkbox" name="consent" required>
        <span>I'm this player's parent or legal guardian, and I agree to the <a href="privacy.html" target="_blank">privacy notice</a>.
        Baseball Quest stores my player's first name, last initial, training check-offs and any videos I choose to upload.
        Only their coach sees videos; teammates see first name and training days.</span></label>
      <button class="btn-primary" type="submit">CREATE ACCOUNT</button>
    </form>
    <p class="center sub">Already have an account? <a href="#/login">Log in</a></p>`);
}

function checkEmailPage() {
  authShell(`<div class="card center"><div style="font-size:44px">📬</div><h2>Check your email</h2>
    <p class="muted">Tap the link we just sent to finish setting up your account. It can take a minute, so check spam too.</p>
    <a class="btn" href="#/login">Back to log in</a></div>`);
}

function forgotPage() {
  authShell(`<form class="card" data-form="forgot"><h2>Reset your password</h2>
    <p class="muted small">We'll email you a link to choose a new one.</p>
    <label for="email">Email</label><input id="email" name="email" type="email" required>
    <button class="btn-primary" type="submit">SEND RESET LINK</button></form>
    <p class="center"><a href="#/login">Back to log in</a></p>`);
}

function newPasswordPage() {
  authShell(`<form class="card" data-form="new-password"><h2>Choose a new password</h2>
    <label for="password">New password (8+ characters)</label><input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required>
    <button class="btn-primary" type="submit">SAVE PASSWORD</button></form>`);
}

// ---------- family pages ----------

async function homePage() {
  await loadProfile();
  if (state.profile.role === 'coach') { location.hash = '#/coach'; return; }
  if (!state.players.length) { location.hash = '#/add-player'; return; }
  const kids = state.players.map(p => `
    <a class="kid" href="#/p/${p.id}"><div class="avatar">${esc(p.avatar)}</div>
      <div class="grow"><h3>${esc(p.name)}</h3>
        <div class="small muted">${[...p.teams.map(t => esc(t.name)), ...p.coaches.map(c => '1-on-1 with ' + esc(c.full_name || 'coach'))].join(' · ') || 'Not on a team yet'}</div></div>
      <span class="xp">TRAIN →</span></a>`).join('');
  page(`${topbar(`<button class="iconbtn" data-act="sign-out">Log out</button>`)}
    <section class="hero"><div class="eyebrow">Hi ${esc(state.profile.full_name || 'there')}</div><h1>Your players</h1>
      <div class="sub">Tap a player to log today's training.</div></section>
    ${kids}
    <div class="actions" style="justify-content:center"><a class="btn" href="#/add-player">+ Add another player</a></div>
    <div class="motto">“YOUR HABITS WILL DETERMINE <span>YOUR FUTURE</span>”</div>`);
}

function addPlayerPage() {
  page(`${topbar(state.players.length ? `<a class="iconbtn" href="#/">Done</a>` : `<button class="iconbtn" data-act="sign-out">Log out</button>`)}
    <section class="hero"><div class="eyebrow">Step 1</div><h1>Add your player</h1>
      <div class="sub">First name and last initial only. That's all teammates will see.</div></section>
    <form class="card" data-form="add-player">
      <div class="row"><div class="grow"><label for="first">First name</label><input id="first" name="first_name" maxlength="24" required></div>
        <div style="width:110px"><label for="initial">Last initial</label><input id="initial" name="last_initial" maxlength="1"></div></div>
      <label>Pick an icon</label>
      <div class="avatars">${AVATARS.map((a, i) => `<label><input type="radio" name="avatar" value="${a}" ${i === 0 ? 'checked' : ''}><span>${a}</span></label>`).join('')}</div>
      <label for="code">Team or coach code (optional)</label>
      <input id="code" name="code" maxlength="12" placeholder="e.g. LUG11U" autocapitalize="characters">
      <p class="small muted">Coach Titus gives each team a code, plus a separate code for 1-on-1 training.</p>
      <button class="btn-primary" type="submit">ADD PLAYER</button>
    </form>`);
}

async function playerPage(pid) {
  if (!state.profile) await loadProfile();
  const player = state.players.find(p => p.id === pid);
  if (!player) { location.hash = '#/'; return; }
  const day = today();
  const wk = await api.getPlayerWeek(pid, day);
  state.week = { pid, day, wk };

  const logsToday = new Map(wk.logs.filter(l => l.log_date === day).map(l => [l.plan_item_id, l]));
  const dayIsos = wk.days.map(d => d.log_date);
  const closed = dayIsos.includes(day);
  const perfectToday = wk.days.find(d => d.log_date === day)?.perfect;
  const items = wk.plans.flatMap(p => p.items);
  const doneCount = items.filter(i => logsToday.has(i.id)).length;
  const xp = totalXP({ drillCount: wk.drillCount, days: wk.days });
  const lvl = levelInfo(xp);
  const st = streak(dayIsos, day);
  const commentsByLog = new Map();
  for (const c of wk.comments) commentsByLog.set(c.drill_log_id, (commentsByLog.get(c.drill_log_id) || 0) + 1);
  const noteCount = item => wk.logs.filter(l => l.plan_item_id === item.id).reduce((n, l) => n + (commentsByLog.get(l.id) || 0), 0);

  const planHtml = wk.plans.map(p => `
    <div class="section-title"><h2>${p.teamName ? '👥 ' + esc(p.teamName) : '🎯 1-on-1'}</h2><span>${esc(p.title)}</span></div>
    ${p.note ? `<div class="note">📣 ${esc(p.note)}</div>` : ''}
    <div class="quest-list">${p.items.map(it => {
      const log = logsToday.get(it.id);
      const notes = noteCount(it);
      return `<div class="quest ${log ? 'done' : ''}">
        <button class="check" data-act="toggle" data-item="${it.id}" aria-label="Mark ${esc(it.drill.title)} done" ${closed ? 'disabled' : ''}></button>
        <button class="qtext" data-act="drill" data-item="${it.id}">
          <b>${esc(it.drill.title)}</b>
          <small><span class="chip cat-${esc(it.drill.category)}">${esc(it.drill.category)}</span>${esc(it.reps)}
            ${it.video_required ? ' · 🎥 film it' : ''}${log?.video_path ? ' · ✅ video sent' : ''}${notes ? ` · <span class="badge">💬 ${notes}</span>` : ''}</small>
        </button>
        <div class="xp">+${XP_PER_DRILL} XP</div></div>`;
    }).join('')}</div>`).join('');

  let completeLabel;
  let completeDisabled = false;
  let completeClass = 'complete';
  if (closed) {
    completeLabel = perfectToday ? 'PERFECT TRAINING DAY ✓' : "TODAY'S TRAINING COMPLETE ✓";
    completeDisabled = true;
    completeClass += ' claimed';
  } else if (doneCount === 0) {
    completeLabel = 'CHECK OFF AT LEAST 1 DRILL';
    completeDisabled = true;
  } else if (doneCount >= items.length) {
    completeLabel = `COMPLETE PERFECT DAY +${XP_PER_DAY + XP_PERFECT_BONUS} XP`;
  } else {
    completeLabel = `COMPLETE TODAY'S TRAINING +${XP_PER_DAY} XP`;
  }

  const week = weekDates(wk.monday).map((d, i) => {
    const done = dayIsos.includes(d);
    return `<div class="day ${done ? 'done' : ''} ${d === day ? 'today' : ''}"><div class="dot">${done ? '⭐' : '·'}</div><small>${DAY_LETTERS[i]}</small></div>`;
  }).join('');
  const weekCount = weekDates(wk.monday).filter(d => dayIsos.includes(d)).length;

  const noPlans = !wk.plans.length ? `
    <div class="card center"><div style="font-size:36px">📋</div><h3>No drills posted for this week yet</h3>
      <p class="muted small">${player.teams.length || player.coaches.length ? 'Your coach will post this week\'s plan soon.' : 'Join your team or coach with the code they gave you.'}</p></div>` : '';

  page(`${topbar(`${state.players.length > 1 ? '<a class="iconbtn" href="#/">Players</a>' : ''}<button class="iconbtn" data-act="player-menu" data-pid="${pid}" aria-label="Settings">⚙︎</button>`)}
    <section class="hero"><div class="eyebrow">Player profile</div>
      <h1>${esc(player.avatar)} ${esc(player.first_name)}</h1><div class="sub">${esc(longDate())}</div>
      <div class="stats">
        <div class="stat"><strong>${lvl.level}</strong><small>Level</small></div>
        <div class="stat"><strong>${xp.toLocaleString()}</strong><small>Total XP</small></div>
        <div class="stat"><strong>${st} 🔥</strong><small>Day streak</small></div>
      </div>
      <div class="levelbar" title="${lvl.into} / 500 XP to next level"><div style="width:${lvl.pct}%"></div></div>
    </section>
    ${noPlans}
    ${planHtml}
    ${items.length ? `<button class="${completeClass}" data-act="complete" ${completeDisabled ? 'disabled' : ''}>${completeLabel}</button>
      ${!closed && doneCount ? '<p class="center small muted">Once you complete the day, today\'s check-offs are locked in.</p>' : ''}` : ''}
    <section class="card"><div class="row between"><b>This week</b><small class="muted">${weekCount} / 7 days</small></div><div class="days">${week}</div></section>
    <div id="teams"></div>
    <div class="actions" style="justify-content:center"><button class="btn" data-act="join" data-pid="${pid}">+ Join a team or coach</button></div>
    <div class="motto">“YOUR HABITS WILL DETERMINE <span>YOUR FUTURE</span>”</div>`);

  // Team boards load after the main screen so it shows up fast.
  const teamsEl = document.getElementById('teams');
  for (const t of player.teams) {
    const board = await api.getTeamBoard(t.id, day, pid);
    if (state.week?.pid !== pid) return;   // user moved on
    teamsEl.insertAdjacentHTML('beforeend', teamBoardHtml(board, pid, day));
  }
}

function teamBoardHtml(board, pid, day) {
  const monday = mondayOf(day);
  const week = new Set(weekDates(monday));
  const byPlayer = new Map(board.players.map(p => [p.id, []]));
  for (const d of board.days) byPlayer.get(d.player_id)?.push(d.log_date);
  const rows = rankBoard(board.players.map(p => {
    const days = byPlayer.get(p.id) || [];
    return { ...p, days, daysThisWeek: days.filter(d => week.has(d)).length, streak: streak(days, day), today: days.includes(day) };
  }));
  const fivesTo = id => board.highFives.filter(h => h.to_player === id).length;
  const sent = id => board.highFives.some(h => h.to_player === id && h.from_player === pid);
  const goal = board.team.team_goal || 1;
  const pct = Math.min(100, Math.round((board.drillsThisWeek / goal) * 100));
  return `
    <div class="section-title"><h2>🏆 ${esc(board.team.name)}</h2><span>Resets every Monday</span></div>
    <section class="card">
      <div class="row between"><b>Team Quest</b><b>${board.drillsThisWeek} / ${goal}</b></div>
      <p class="small muted" style="margin:6px 0 0">Every drill anyone on the team checks off counts toward the goal.</p>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </section>
    <section class="card"><div class="row between"><b>Who's putting in the work</b><small class="muted">days this week</small></div>
      <div class="board">${rows.map((r, i) => `
        <div class="brow ${r.id === pid ? 'me' : ''}">
          <div class="rank">${i + 1}</div><div class="avatar">${esc(r.avatar)}</div>
          <div class="grow"><b>${esc(r.name)}</b>
            <div class="row small muted">${daysDots(r.days, monday)} ${r.streak ? `${r.streak} 🔥` : ''} ${fivesTo(r.id) ? `· 🙌 ${fivesTo(r.id)}` : ''}</div></div>
          ${r.id !== pid && r.today
            ? `<button class="five ${sent(r.id) ? 'sent' : ''}" data-act="five" data-to="${r.id}" data-from="${pid}" ${sent(r.id) ? 'disabled' : ''}>${sent(r.id) ? '🙌 Sent' : '🙌 High five'}</button>`
            : `<b>${r.daysThisWeek}</b>`}
        </div>`).join('')}</div></section>`;
}

function drillModal(itemId) {
  const { pid, day, wk } = state.week;
  const item = wk.plans.flatMap(p => p.items).find(i => i.id === itemId);
  if (!item) return;
  const d = item.drill;
  const logToday = wk.logs.find(l => l.plan_item_id === itemId && l.log_date === day);
  const logIds = new Set(wk.logs.filter(l => l.plan_item_id === itemId).map(l => l.id));
  const comments = wk.comments.filter(c => logIds.has(c.drill_log_id));
  const link = safeLink(d.video_url);
  openModal(`
    <div class="row between"><span class="chip cat-${esc(d.category)}">${esc(d.category)}</span><button class="iconbtn" data-act="close">✕</button></div>
    <h3 style="margin-top:10px">${esc(d.title)}</h3>
    <div class="xp">${esc(item.reps)}</div>
    ${d.instructions ? `<p style="white-space:pre-wrap">${esc(d.instructions)}</p>` : ''}
    ${link ? `<p><a class="btn" href="${esc(link)}" target="_blank" rel="noopener">▶ Watch demo video</a></p>` : ''}
    <div id="drill-video"></div>
    <hr style="border-color:var(--line);margin:16px 0">
    ${logToday ? `
      <b>Proof video ${item.video_required ? '(coach asked for one)' : '(optional)'}</b>
      <p class="small muted">Keep it short, about 15 seconds. Only your coach and your family can see it.</p>
      <div id="proof-video"></div>
      <label class="btn" style="display:inline-block;margin:8px 0 0">🎥 ${logToday.video_path ? 'Replace video' : 'Add a video'}
        <input type="file" accept="video/*" class="hidden" data-change="proof" data-log="${logToday.id}" data-pid="${pid}"></label>`
      : `<p class="small muted">Check this drill off first, then you can add a proof video.</p>`}
    ${comments.length ? `<h3 style="margin-top:18px">Coach notes</h3>${comments.map(c => `<div class="comment"><b>${esc(c.author)} · ${esc(prettyDate(c.created_at.slice(0, 10)))}</b>${esc(c.body)}</div>`).join('')}` : ''}`);
  if (d.video_path) api.videoUrl('drill-videos', d.video_path).then(u => { const el = document.getElementById('drill-video'); if (el) el.innerHTML = videoBlock(u); });
  if (logToday?.video_path) api.videoUrl('proof-videos', logToday.video_path).then(u => { const el = document.getElementById('proof-video'); if (el) el.innerHTML = videoBlock(u); });
}

// ---------- coach pages ----------

async function requireCoach() {
  if (!state.profile) await loadProfile();
  if (state.profile.role !== 'coach') {
    location.hash = '#/';
    throw new Error('Coach accounts only.');
  }
}

async function coachPlayersPage() {
  await requireCoach();
  const day = today();
  const monday = mondayOf(day);
  const roster = await api.getRoster(day);
  const days = new Map(roster.players.map(p => [p.id, []]));
  for (const d of roster.days) days.get(d.player_id)?.push(d.log_date);
  const week = new Set(weekDates(monday));
  const rows = roster.players.map(p => {
    const ds = (days.get(p.id) || []).sort();
    return { ...p, ds, week: ds.filter(d => week.has(d)).length, streak: streak(ds, day), last: ds[ds.length - 1] || null };
  });
  const behind = rows.filter(r => !r.last || r.last < addDays(day, -2)).sort((a, b) => (a.last || '').localeCompare(b.last || ''));
  const onTrack = rows.filter(r => !behind.includes(r)).sort((a, b) => b.week - a.week || b.streak - a.streak);
  const trained = rows.filter(r => r.week > 0).length;

  const row = r => `<div class="brow"><div class="avatar">${esc(r.avatar)}</div>
    <div class="grow"><b>${esc(r.name)}</b>
      <div class="small muted">${[...r.teams.map(esc), r.solo ? '1-on-1' : ''].filter(Boolean).join(' · ')}</div>
      <div class="row small muted">${daysDots(r.ds, monday)} ${r.streak ? r.streak + ' 🔥' : ''}</div></div>
    <div class="small muted" style="text-align:right">${r.last ? 'Last: ' + esc(prettyDate(r.last)) : 'Not yet'}</div></div>`;

  page(`${topbar(`<button class="iconbtn" data-act="sign-out">Log out</button>`)}
    <section class="hero"><div class="eyebrow">Coach dashboard</div><h1>${esc(state.profile.full_name || 'Coach')}</h1>
      <div class="sub">Week of ${esc(prettyDate(monday))}</div>
      <div class="stats">
        <div class="stat"><strong>${rows.length}</strong><small>Players</small></div>
        <div class="stat"><strong>${trained}</strong><small>Trained this wk</small></div>
        <div class="stat"><strong>${behind.length}</strong><small>Need a nudge</small></div>
      </div></section>
    ${!rows.length ? `<div class="card"><h3>No players yet</h3><p class="muted small">Create a team on the Teams tab and share its code with parents. Your 1-on-1 code is below.</p></div>` : ''}
    ${behind.length ? `<div class="section-title"><h2>Need a nudge</h2><span>No training in 3+ days</span></div><div class="board">${behind.map(row).join('')}</div>` : ''}
    ${onTrack.length ? `<div class="section-title"><h2>On track</h2><span>days this week</span></div><div class="board">${onTrack.map(row).join('')}</div>` : ''}
    <section class="card"><b>Your 1-on-1 code</b><p class="small muted" style="margin:4px 0 8px">Give this to parents of players you train individually. They enter it when adding their player.</p>
      <div class="code">${esc(state.profile.coach_code || '—')}</div></section>`, coachNav('coach'));
}

let planWeek = null;

async function coachPlansPage() {
  await requireCoach();
  planWeek = planWeek || mondayOf(today());
  const [plans, teams, roster, drills] = await Promise.all([
    api.listPlans(planWeek), api.listTeams(), api.getRoster(today()), api.listDrills(),
  ]);
  state.coach = { teams, roster, drills };
  const isThisWeek = planWeek === mondayOf(today());
  page(`${topbar()}
    <section class="hero"><div class="eyebrow">Weekly plans</div><h1>Week of ${esc(prettyDate(planWeek))}</h1>
      <div class="row" style="margin-top:12px">
        <button class="btn sm" data-act="week" data-step="-7">← Prev</button>
        ${isThisWeek ? '<span class="small muted">This week</span>' : `<button class="btn sm" data-act="week" data-step="0">This week</button>`}
        <button class="btn sm" data-act="week" data-step="7">Next →</button></div></section>
    <div class="actions"><button class="btn" data-act="copy-week">Copy last week's plans</button><button class="btn primary" data-act="new-plan">+ New plan</button></div>
    ${plans.length ? plans.map(p => `
      <section class="card"><div class="row between"><div><b>${p.team_id ? '👥' : '🎯'} ${esc(p.targetName)}</b>
          <div class="small muted">${esc(p.title)}</div></div>
        <button class="btn sm danger" data-act="delete-plan" data-id="${p.id}">Delete</button></div>
        ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
        <div class="small" style="margin-top:10px;line-height:1.9">${p.items.map(i => `<span class="chip cat-${esc(i.drill.category)}">${esc(i.drill.category[0])}</span>${esc(i.drill.title)} <span class="muted">· ${esc(i.reps)}</span>`).join('<br>')}</div>
      </section>`).join('')
      : `<div class="card center"><h3>No plans for this week</h3><p class="muted small">Make one for a team or a 1-on-1 player, or copy last week's.</p></div>`}`, coachNav('coach/plans'));
}

function newPlanModal() {
  const { teams, roster, drills } = state.coach;
  const solo = roster.players.filter(p => p.solo);
  if (!drills.length) { toast('Add some drills first'); location.hash = '#/coach/drills'; return; }
  if (!teams.length && !solo.length) { toast('Create a team first'); location.hash = '#/coach/teams'; return; }
  const byCat = CATEGORIES.map(c => [c, drills.filter(d => d.category === c)]).filter(([, ds]) => ds.length);
  openModal(`<form data-form="plan">
    <div class="row between"><h3>New plan · week of ${esc(prettyDate(planWeek))}</h3><button type="button" class="iconbtn" data-act="close">✕</button></div>
    <label for="target">Who is it for?</label>
    <select id="target" name="target" required>
      ${teams.length ? `<optgroup label="Teams">${teams.map(t => `<option value="team:${t.id}">👥 ${esc(t.name)}</option>`).join('')}</optgroup>` : ''}
      ${solo.length ? `<optgroup label="1-on-1 players">${solo.map(p => `<option value="player:${p.id}">🎯 ${esc(p.name)}</option>`).join('')}</optgroup>` : ''}
    </select>
    <label for="title">Title</label><input id="title" name="title" maxlength="60" placeholder="Offseason week 3">
    <label for="note">Message to players (optional)</label><textarea id="note" name="note" maxlength="500" placeholder="Even one drill counts. Film your tee work once this week!"></textarea>
    <label>Drills (they'll see these every day this week)</label>
    ${byCat.map(([c, ds]) => `<div class="small muted" style="margin-top:12px;font-weight:800">${esc(c.toUpperCase())}</div>
      ${ds.map(d => `<div class="pick"><input type="checkbox" name="drill" value="${d.id}" aria-label="${esc(d.title)}">
        <span class="grow">${esc(d.title)}</span>
        <input type="text" name="reps-${d.id}" placeholder="${esc(d.reps || 'reps')}" aria-label="Reps for ${esc(d.title)}">
        <label class="small" style="margin:0;display:flex;gap:4px;align-items:center" title="Ask for a proof video"><input type="checkbox" name="video-${d.id}">🎥</label></div>`).join('')}`).join('')}
    <p class="small muted">Leave reps blank to use the drill's default. Tick 🎥 to ask for a proof video.</p>
    <button class="btn-primary" type="submit">SAVE PLAN</button></form>`);
}

async function coachDrillsPage() {
  await requireCoach();
  const drills = await api.listDrills();
  state.coach = { ...(state.coach || {}), drills };
  page(`${topbar()}
    <section class="hero"><div class="eyebrow">Drill library</div><h1>${drills.length} drills</h1>
      <div class="sub">Build these once, then pick from them for each weekly plan.</div></section>
    <div class="actions"><button class="btn primary" data-act="edit-drill">+ New drill</button></div>
    ${CATEGORIES.map(c => {
      const ds = drills.filter(d => d.category === c);
      if (!ds.length) return '';
      return `<div class="section-title"><h2 class="cat-${c}">${c}</h2><span>${ds.length}</span></div>
        <div class="board">${ds.map(d => `<div class="brow"><div class="grow"><b>${esc(d.title)}</b>
          <div class="small muted">${esc(d.reps)}${d.video_url || d.video_path ? ' · ▶ video' : ''}</div></div>
          <button class="btn sm" data-act="edit-drill" data-id="${d.id}">Edit</button></div>`).join('')}</div>`;
    }).join('')}`, coachNav('coach/drills'));
}

function drillEditModal(id) {
  const d = id ? state.coach.drills.find(x => x.id === id) : { category: 'Hitting', title: '', reps: '', instructions: '', video_url: '' };
  openModal(`<form data-form="drill" data-id="${id || ''}" data-path="${esc(d.video_path || '')}">
    <div class="row between"><h3>${id ? 'Edit drill' : 'New drill'}</h3><button type="button" class="iconbtn" data-act="close">✕</button></div>
    <label for="cat">Category</label><select id="cat" name="category">${CATEGORIES.map(c => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <label for="dt">Name</label><input id="dt" name="title" required maxlength="80" value="${esc(d.title)}">
    <label for="reps">Default reps</label><input id="reps" name="reps" maxlength="60" value="${esc(d.reps)}" placeholder="3 × 10">
    <label for="ins">How to do it</label><textarea id="ins" name="instructions" maxlength="2000">${esc(d.instructions)}</textarea>
    <label for="vu">Demo video link (YouTube, etc.)</label><input id="vu" name="video_url" type="url" value="${esc(d.video_url || '')}" placeholder="https://">
    <label for="vf">…or upload a demo video (up to ${MAX_DRILL_MB} MB)</label><input id="vf" name="video_file" type="file" accept="video/*">
    ${d.video_path ? '<p class="small muted">A video is already uploaded. Choosing a new file replaces it.</p>' : ''}
    <button class="btn-primary" type="submit">SAVE DRILL</button>
    ${id ? `<div class="actions"><button type="button" class="btn sm danger" data-act="archive-drill" data-id="${id}">Remove from library</button></div>` : ''}
  </form>`);
}

async function coachReviewPage() {
  await requireCoach();
  const since = addDays(today(), -7);
  const feed = await api.reviewFeed(since);
  const videos = feed.filter(f => f.video_path);
  const item = f => `<section class="card"><div class="row"><div class="avatar">${esc(f.player?.avatar)}</div>
      <div class="grow"><b>${esc(f.player?.name)}</b><div class="small muted">${esc(f.drill?.title || 'Drill')} · ${esc(prettyDate(f.log_date))}</div></div>
      ${f.video_path ? `<button class="btn sm" data-act="watch" data-path="${esc(f.video_path)}" data-target="v-${f.id}">▶ Watch</button>` : ''}</div>
    <div id="v-${f.id}"></div>
    ${f.comments.map(c => `<div class="comment"><b>${esc(c.author)}</b>${esc(c.body)}</div>`).join('')}
    <form data-form="comment" data-log="${f.id}" class="row" style="margin-top:10px">
      <input name="body" maxlength="1000" placeholder="Feedback for ${esc(f.player?.name?.split(' ')[0] || 'player')}…" required>
      <button class="btn" type="submit">Send</button></form></section>`;
  page(`${topbar()}
    <section class="hero"><div class="eyebrow">Review</div><h1>Last 7 days</h1>
      <div class="sub">${videos.length} video${videos.length === 1 ? '' : 's'} · ${feed.length} drills logged</div></section>
    <div class="section-title"><h2>🎥 Videos</h2></div>
    ${videos.length ? videos.map(item).join('') : '<div class="card muted small">No proof videos this week yet.</div>'}
    <div class="section-title"><h2>All check-offs</h2><span>leave a note on any drill</span></div>
    ${feed.filter(f => !f.video_path).slice(0, 60).map(item).join('') || '<div class="card muted small">Nothing logged yet this week.</div>'}`, coachNav('coach/review'));
}

async function coachTeamsPage() {
  await requireCoach();
  const teams = await api.listTeams();
  page(`${topbar()}
    <section class="hero"><div class="eyebrow">Teams</div><h1>${teams.length} team${teams.length === 1 ? '' : 's'}</h1>
      <div class="sub">Parents join a team by entering its code when they add their player.</div></section>
    ${teams.map(t => `<section class="card"><div class="row between"><div><b>${esc(t.name)}</b><div class="small muted">${t.memberCount} player${t.memberCount === 1 ? '' : 's'}</div></div>
        <div class="code">${esc(t.join_code)}</div></div>
      <form data-form="team-goal" data-id="${t.id}" class="row" style="margin-top:12px">
        <label for="g-${t.id}" class="small" style="margin:0;white-space:nowrap">Weekly Team Quest goal</label>
        <input id="g-${t.id}" name="goal" type="number" min="1" max="10000" value="${t.team_goal}" style="width:100px">
        <button class="btn sm" type="submit">Save</button></form></section>`).join('')}
    <form class="card" data-form="team"><b>New team</b>
      <label for="tn">Team name</label><input id="tn" name="name" required maxlength="40" placeholder="Lugnuts 11U">
      <label for="tg">Weekly Team Quest goal (total drills)</label><input id="tg" name="goal" type="number" min="1" value="150">
      <p class="small muted">Rough guide: players × 5 days × 5 drills. 6 players doing 5 drills on 5 days = 150.</p>
      <button class="btn-primary" type="submit">CREATE TEAM</button></form>`, coachNav('coach/teams'));
}

// ---------- actions ----------

const actions = {
  'close': closeModal,
  'sign-out': async () => {
    await api.signOut();
    state.session = null; state.profile = null; state.players = [];
    location.hash = '#/login';
    if (DEMO) location.href = location.pathname;
  },
  'demo-role': el => {
    api.setDemoRole(el.dataset.role);
    state.profile = null;
    location.hash = el.dataset.role === 'coach' ? '#/coach' : '#/';
    route();
  },
  'demo-reset': () => {
    api.resetDemo();
    state.profile = null;
    toast('Demo reset');
    route();
  },
  'toggle': async el => {
    const { pid, day, wk } = state.week;
    const itemId = el.dataset.item;
    const log = wk.logs.find(l => l.plan_item_id === itemId && l.log_date === day);
    await busy(el, async () => {
      try {
        if (log) await api.unlogDrill(log.id);
        else await api.logDrill(pid, itemId, day);
      } catch (err) { toast(err.message); }
    });
    await playerPage(pid);
  },
  'complete': async el => {
    const { pid, day } = state.week;
    await busy(el, async () => {
      try {
        const perfect = await api.completeDay(pid, day);
        toast(perfect ? `+${XP_PER_DAY + XP_PERFECT_BONUS} XP · Perfect day! 🏆` : `+${XP_PER_DAY} XP · Training logged 💪`);
      } catch (err) { toast(err.message); }
    });
    await playerPage(pid);
  },
  'drill': el => drillModal(el.dataset.item),
  'five': async el => {
    await busy(el, () => api.highFive(el.dataset.from, el.dataset.to, today()).catch(err => toast(err.message)));
    el.textContent = '🙌 Sent';
    el.classList.add('sent');
    el.disabled = true;
  },
  'join': el => openModal(`<form data-form="join" data-pid="${el.dataset.pid}">
      <div class="row between"><h3>Join a team or coach</h3><button type="button" class="iconbtn" data-act="close">✕</button></div>
      <p class="small muted">Enter the code from Coach Titus. Team codes join the team; a coach's 1-on-1 code adds private training.</p>
      <label for="jc">Code</label><input id="jc" name="code" required maxlength="12" autocapitalize="characters">
      <button class="btn-primary" type="submit">JOIN</button></form>`),
  'player-menu': el => {
    const p = state.players.find(x => x.id === el.dataset.pid);
    openModal(`<div class="row between"><h3>${esc(p.name)}</h3><button class="iconbtn" data-act="close">✕</button></div>
      <p class="small muted">${[...p.teams.map(t => esc(t.name)), ...p.coaches.map(c => '1-on-1 with ' + esc(c.full_name || 'coach'))].join('<br>') || 'Not on a team yet.'}</p>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn" data-act="join" data-pid="${p.id}">Join a team or coach</button>
        <a class="btn" href="#/add-player">Add another player</a>
        <button class="btn" data-act="sign-out">Log out</button></div>
      <hr style="border-color:var(--line);margin:18px 0">
      <p class="small muted">Removing ${esc(p.first_name)} permanently deletes their check-offs, XP and videos.</p>
      <button class="btn sm danger" data-act="remove-player" data-pid="${p.id}">Remove ${esc(p.first_name)}</button>`);
  },
  'remove-player': async el => {
    const p = state.players.find(x => x.id === el.dataset.pid);
    if (!confirm(`Remove ${p.first_name} and delete all of their training history and videos? This can't be undone.`)) return;
    await busy(el, () => api.removePlayer(p.id));
    state.profile = null;
    toast(`${p.first_name} removed`);
    location.hash = '#/';
    route();
  },
  'week': el => {
    const step = Number(el.dataset.step);
    planWeek = step === 0 ? mondayOf(today()) : addDays(planWeek, step);
    route();
  },
  'new-plan': newPlanModal,
  'copy-week': async el => {
    const prev = await api.listPlans(addDays(planWeek, -7));
    if (!prev.length) { toast('No plans last week to copy'); return; }
    await busy(el, async () => {
      for (const p of prev) {
        await api.createPlan({
          week_start: planWeek, team_id: p.team_id, player_id: p.player_id, title: p.title, note: p.note,
          items: p.items.map(i => ({ drill_id: i.drill.id, reps: i.reps === i.drill.reps ? null : i.reps })),
        });
      }
    });
    toast(`Copied ${prev.length} plan${prev.length === 1 ? '' : 's'}`);
    route();
  },
  'delete-plan': async el => {
    if (!confirm("Delete this plan? Players' check-offs for it are deleted too.")) return;
    await busy(el, () => api.deletePlan(el.dataset.id));
    route();
  },
  'edit-drill': el => drillEditModal(el.dataset.id),
  'archive-drill': async el => {
    if (!confirm('Remove this drill from your library? Existing plans keep it.')) return;
    await api.archiveDrill(el.dataset.id);
    closeModal();
    route();
  },
  'watch': async el => {
    const box = document.getElementById(el.dataset.target);
    box.innerHTML = '<div class="small muted">Loading…</div>';
    const url = await api.videoUrl('proof-videos', el.dataset.path);
    box.innerHTML = url ? videoBlock(url) : '<div class="small muted">Video not available.</div>';
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el, e)).catch(err => toast(err.message));
});

// ---------- forms ----------

const forms = {
  'login': async (f, form) => {
    await api.signIn({ email: f.get('email').trim(), password: f.get('password') });
    state.session = await api.getSession();
    location.hash = '#/';
  },
  'signup': async f => {
    await api.signUp({ email: f.get('email').trim(), password: f.get('password'), fullName: f.get('fullName').trim(), consent: !!f.get('consent') });
    location.hash = '#/check-email';
  },
  'forgot': async (f, form) => {
    await api.sendPasswordReset(f.get('email').trim());
    form.innerHTML = '<h2>Check your email</h2><p class="muted">If that address has an account, a reset link is on its way.</p>';
  },
  'new-password': async f => {
    await api.setNewPassword(f.get('password'));
    state.recovery = false;
    toast('Password updated');
    location.hash = '#/';
  },
  'add-player': async f => {
    const { id } = await api.addPlayer({
      first_name: f.get('first_name').trim(),
      last_initial: (f.get('last_initial') || '').trim().toUpperCase().slice(0, 1),
      avatar: f.get('avatar') || '⚾',
    });
    const code = (f.get('code') || '').trim();
    if (code) {
      try { toast(await api.joinWithCode(code, id)); } catch (err) { toast(`Player added, but: ${err.message}`); }
    }
    state.players = await api.listMyPlayers();
    location.hash = `#/p/${id}`;
  },
  'join': async (f, form) => {
    const msg = await api.joinWithCode(f.get('code'), form.dataset.pid);
    closeModal();
    toast(msg);
    state.players = await api.listMyPlayers();
    route();
  },
  'plan': async f => {
    const [kind, id] = f.get('target').split(':');
    const items = f.getAll('drill').map(drillId => ({
      drill_id: drillId, reps: (f.get('reps-' + drillId) || '').trim() || null, video_required: !!f.get('video-' + drillId),
    }));
    if (!items.length) throw new Error('Pick at least one drill.');
    await api.createPlan({
      week_start: planWeek, team_id: kind === 'team' ? id : null, player_id: kind === 'player' ? id : null,
      title: f.get('title').trim(), note: f.get('note').trim(), items,
    });
    closeModal();
    toast('Plan saved');
    route();
  },
  'drill': async (f, form) => {
    const file = f.get('video_file');
    let video_path = form.dataset.path || null;
    if (file && file.size) {
      if (file.size > MAX_DRILL_MB * 1024 * 1024) throw new Error(`That video is over ${MAX_DRILL_MB} MB. Try a shorter clip.`);
      toast('Uploading video…');
      video_path = await api.uploadDrillVideo(file);
    }
    await api.saveDrill({
      id: form.dataset.id || undefined, category: f.get('category'), title: f.get('title').trim(),
      reps: f.get('reps').trim(), instructions: f.get('instructions').trim(), video_url: f.get('video_url').trim() || null, video_path,
    });
    closeModal();
    toast('Drill saved');
    route();
  },
  'comment': async (f, form) => {
    await api.addComment(form.dataset.log, f.get('body').trim());
    const box = document.createElement('div');
    box.className = 'comment';
    box.innerHTML = `<b>${esc(state.profile.full_name || 'Coach')}</b>${esc(f.get('body'))}`;
    form.before(box);
    form.reset();
    toast('Sent');
  },
  'team': async f => {
    await api.createTeam(f.get('name').trim(), Number(f.get('goal')) || 150);
    toast('Team created');
    route();
  },
  'team-goal': async (f, form) => {
    await api.updateTeam(form.dataset.id, { team_goal: Number(f.get('goal')) });
    toast('Goal saved');
  },
};

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fn = forms[form.dataset.form];
  const btn = form.querySelector('[type=submit]');
  try {
    await busy(btn, () => fn(new FormData(form), form));
  } catch (err) {
    showError(form, err);
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.change !== 'proof' || !el.files?.[0]) return;
  const file = el.files[0];
  if (file.size > MAX_PROOF_MB * 1024 * 1024) {
    toast(`That video is over ${MAX_PROOF_MB} MB. Film about 15 seconds and try again.`);
    return;
  }
  toast('Uploading video…');
  try {
    await api.uploadProof(el.dataset.pid, el.dataset.log, file);
    toast('Video sent to your coach ✅');
    closeModal();
    await playerPage(el.dataset.pid);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- start ----------

api.onAuthChange((session, event) => {
  const was = !!state.session;
  state.session = session;
  if (event === 'PASSWORD_RECOVERY') {
    state.recovery = true;
    location.hash = '#/new-password';
    return;
  }
  if (!session && was) {
    state.profile = null;
    location.hash = '#/login';
  }
});

state.session = await api.getSession();
// Supabase leaves its tokens in the URL hash after an email link; clear them
// before routing, but keep an error message if the link was bad or expired.
if (/^#error/.test(location.hash)) {
  const msg = new URLSearchParams(location.hash.slice(1)).get('error_description');
  state.linkError = msg ? `That email link didn't work (${msg}). Log in, or ask for a new link.` : null;
  history.replaceState(null, '', location.pathname + location.search + '#/login');
} else if (/access_token|refresh_token|type=/.test(location.hash)) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
}
route();

if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('service-worker.js').catch(() => {});
