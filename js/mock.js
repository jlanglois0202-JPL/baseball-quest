// Demo mode: same functions as api.js, backed by sample data kept in this
// browser. Lets a coach or parent click through without an account.
import { addDays, localISO, mondayOf } from './game.js';

export const isDemo = true;

const KEY = 'bq-demo-v2';
const COACH = 'coach-titus';
const PARENT = 'parent-demo';
let s = load();
let authCb = () => {};

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* private mode: fall through to fresh data */ }
  return seed();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function resetDemo() {
  s = seed();
  save();
}

export function demoRole() { return s.role; }
export function setDemoRole(role) { s.role = role; save(); authCb(session()); }

function seed() {
  const today = localISO();
  const monday = mondayOf(today);
  const st = {
    role: 'parent',
    profiles: [
      { id: COACH, full_name: 'Coach Titus', role: 'coach', coach_code: 'TITUS1' },
      { id: PARENT, full_name: 'Demo Parent', role: 'parent', coach_code: null },
    ],
    players: [], teams: [], team_members: [], coach_clients: [], drills: [],
    plans: [], plan_items: [], drill_logs: [], training_days: [], comments: [], high_fives: [],
  };
  const drill = (category, title, reps, instructions = '', video_url = null) => {
    const d = { id: uuid(), coach_id: COACH, category, title, reps, instructions, video_url, video_path: null, archived: false };
    st.drills.push(d);
    return d;
  };
  const D = {
    load: drill('Hitting', 'Load & Separate', '10 reps', 'Feet set, hands back as the front foot strides. Hold the separation for a one-count, then reset.'),
    dry: drill('Hitting', 'Dry Swings', '10–20 dry swings', 'Full swings with no ball. Finish balanced and hold your finish.'),
    tee: drill('Hitting', 'Tee Swings', '25–50 swings', 'Line drives back up the middle. Move the tee inside/outside every 10.'),
    plate: drill('Hitting', 'Addressing the Plate', '10 reps'),
    knee: drill('Infield', 'Knee Drills (1-H / 2-H / B)', '10 for each glove position', 'On both knees: forehand, backhand, two-hands. Soft hands, funnel to the belly.'),
    shuffle: drill('Infield', 'Foot Placement (Shuffle)', '10 shuffles'),
    cross: drill('Infield', 'Crossover', '10 angle creators'),
    drop: drill('Outfield', 'Organic Drop Step L/R', '10 per day', 'Open the hip, first step back on the angle. Eyes stay on the ball.'),
    snaps: drill('Outfield', 'Head Snaps', '10 per day'),
    hips: drill('Outfield', 'Defensive Back Hips (DB Hips)', '10 per day'),
    lunges: drill('Athleticism', 'Lunges', '5 rounds × 10 reps'),
    burpees: drill('Athleticism', 'Burpees', '5 rounds × 10 reps'),
    plank: drill('Athleticism', 'Plank Hold', '45 sec × 4 rounds'),
    push: drill('Athleticism', 'Push Ups', '35–50 reps'),
  };

  const team = { id: uuid(), coach_id: COACH, name: 'Lugnuts 11U', join_code: 'LUG11U', team_goal: 150 };
  st.teams.push(team);

  const player = (first_name, last_initial, avatar, parent = 'other') => {
    const p = { id: uuid(), parent_id: parent, first_name, last_initial, avatar };
    st.players.push(p);
    return p;
  };
  const max = player('Max', 'L', '⚾', PARENT);
  const eli = player('Eli', 'L', '🧢', PARENT);
  const mates = [player('Ben', 'R', '🔥'), player('Cole', 'T', '🦅'), player('Drew', 'M', '💪'), player('Jace', 'B', '⚡'), player('Luke', 'P', '🐐')];
  for (const p of [max, ...mates]) st.team_members.push({ team_id: team.id, player_id: p.id });
  st.coach_clients.push({ coach_id: COACH, player_id: eli.id });

  const plan = (fields, drills) => {
    const p = { id: uuid(), coach_id: COACH, week_start: monday, title: '', note: '', team_id: null, player_id: null, ...fields };
    st.plans.push(p);
    drills.forEach((d, i) => st.plan_items.push({ id: uuid(), plan_id: p.id, drill_id: d.id, reps: null, video_required: i === 0, sort: i }));
    return p;
  };
  const tp = plan({ team_id: team.id, title: 'Offseason Week', note: 'Short and sharp. Even one drill counts. Film your tee work once this week!' },
    [D.tee, D.load, D.knee, D.drop, D.lunges, D.plank]);
  plan({ player_id: eli.id, title: 'Eli: swing path', note: 'Focus on staying through the ball.' }, [D.dry, D.tee, D.push]);

  // Some history so streaks and the leaderboard have something to show.
  const items = st.plan_items.filter(i => i.plan_id === tp.id);
  const history = { [max.id]: [1, 2, 3, 4], [mates[0].id]: [1, 2, 3, 4, 5, 6, 8], [mates[1].id]: [1, 3], [mates[2].id]: [2, 3, 4], [mates[3].id]: [], [mates[4].id]: [1] };
  for (const [pid, back] of Object.entries(history)) {
    for (const n of back) {
      const date = addDays(today, -n);
      const k = 1 + (n % items.length);
      const thisWeek = date >= monday;
      for (const it of items.slice(0, thisWeek ? k : 1)) {
        st.drill_logs.push({ id: uuid(), player_id: pid, plan_item_id: it.id, log_date: date, video_path: null, created_at: date });
      }
      st.training_days.push({ player_id: pid, log_date: date, perfect: thisWeek && k >= items.length });
    }
  }
  // Ben already trained today, so Max has someone to high-five.
  for (const it of items.slice(0, 2)) st.drill_logs.push({ id: uuid(), player_id: mates[0].id, plan_item_id: it.id, log_date: today, video_path: null, created_at: today });
  st.training_days.push({ player_id: mates[0].id, log_date: today, perfect: false });

  const maxLog = st.drill_logs.find(l => l.player_id === max.id);
  if (maxLog) st.comments.push({ id: uuid(), drill_log_id: maxLog.id, author_id: COACH, body: 'Nice work getting after it, Max. Keep that back elbow up!', created_at: maxLog.log_date });
  return st;
}

const me = () => (s.role === 'coach' ? COACH : PARENT);
const name = p => p ? `${p.first_name}${p.last_initial ? ' ' + p.last_initial + '.' : ''}` : '';
const session = () => ({ user: { id: me(), email: s.role === 'coach' ? 'coach@demo' : 'parent@demo' } });
const tick = v => new Promise(r => setTimeout(() => r(v), 60));
const playerTeams = pid => s.team_members.filter(m => m.player_id === pid).map(m => s.teams.find(t => t.id === m.team_id));

function plansFor(pid, date) {
  const monday = mondayOf(date);
  const teamIds = playerTeams(pid).map(t => t.id);
  return s.plans.filter(p => p.week_start === monday && (p.player_id === pid || teamIds.includes(p.team_id)));
}

// ---------- Auth ----------

export async function getSession() { return tick(session()); }
export function onAuthChange(cb) { authCb = cb; }
export async function signUp() { throw new Error('Sign-up is turned off in demo mode.'); }
export async function signIn() { return tick(); }
export async function signOut() { return tick(); }
export async function sendPasswordReset() { return tick(); }
export async function setNewPassword() { return tick(); }

export async function getProfile() {
  return tick({ ...s.profiles.find(p => p.id === me()) });
}

// ---------- Families ----------

export async function listMyPlayers() {
  return tick(s.players.filter(p => p.parent_id === me()).map(p => ({
    ...p, name: name(p),
    teams: playerTeams(p.id).map(t => ({ id: t.id, name: t.name })),
    coaches: s.coach_clients.filter(c => c.player_id === p.id)
      .map(c => ({ id: c.coach_id, full_name: s.profiles.find(x => x.id === c.coach_id).full_name })),
  })));
}

export async function addPlayer({ first_name, last_initial, avatar }) {
  const p = { id: uuid(), parent_id: me(), first_name, last_initial, avatar };
  s.players.push(p); save();
  return tick({ id: p.id });
}

export async function removePlayer(pid) {
  s.players = s.players.filter(p => p.id !== pid);
  for (const k of ['team_members', 'coach_clients', 'drill_logs', 'training_days']) s[k] = s[k].filter(r => r.player_id !== pid);
  save();
  return tick();
}

export async function joinWithCode(code, pid) {
  const c = code.trim().toUpperCase();
  const team = s.teams.find(t => t.join_code === c);
  if (team) {
    if (!s.team_members.some(m => m.team_id === team.id && m.player_id === pid)) s.team_members.push({ team_id: team.id, player_id: pid });
    save();
    return tick('Joined ' + team.name);
  }
  const coach = s.profiles.find(p => p.coach_code === c && p.role === 'coach');
  if (coach) {
    if (!s.coach_clients.some(m => m.coach_id === coach.id && m.player_id === pid)) s.coach_clients.push({ coach_id: coach.id, player_id: pid });
    save();
    return tick('Now training 1-on-1 with ' + coach.full_name);
  }
  throw new Error('That code does not match a team or coach');
}

export async function getPlayerWeek(pid, today) {
  const monday = mondayOf(today);
  const plans = plansFor(pid, today).map(p => ({
    id: p.id, title: p.title, note: p.note,
    teamId: p.team_id, teamName: s.teams.find(t => t.id === p.team_id)?.name ?? null,
    items: s.plan_items.filter(i => i.plan_id === p.id).sort((a, b) => a.sort - b.sort).map(i => {
      const drill = s.drills.find(d => d.id === i.drill_id);
      return { id: i.id, reps: i.reps || drill.reps, video_required: i.video_required, drill };
    }),
  }));
  const logs = s.drill_logs.filter(l => l.player_id === pid && l.log_date >= monday);
  const logIds = new Set(logs.map(l => l.id));
  return tick({
    monday, plans, logs,
    days: s.training_days.filter(d => d.player_id === pid).sort((a, b) => b.log_date.localeCompare(a.log_date)),
    drillCount: s.drill_logs.filter(l => l.player_id === pid).length,
    comments: s.comments.filter(c => logIds.has(c.drill_log_id))
      .map(c => ({ ...c, author: s.profiles.find(p => p.id === c.author_id)?.full_name || 'Coach' })),
  });
}

const dayClosed = (pid, date) => s.training_days.some(d => d.player_id === pid && d.log_date === date);

export async function logDrill(pid, itemId, date) {
  if (dayClosed(pid, date)) throw new Error("Today's training is already complete.");
  if (s.drill_logs.some(l => l.player_id === pid && l.plan_item_id === itemId && l.log_date === date)) throw new Error('Already saved.');
  const row = { id: uuid(), player_id: pid, plan_item_id: itemId, log_date: date, video_path: null, created_at: new Date().toISOString() };
  s.drill_logs.push(row); save();
  return tick({ ...row });
}

export async function unlogDrill(logId) {
  const l = s.drill_logs.find(x => x.id === logId);
  if (l && !dayClosed(l.player_id, l.log_date)) s.drill_logs = s.drill_logs.filter(x => x.id !== logId);
  save();
  return tick();
}

export async function completeDay(pid, date) {
  const done = s.drill_logs.filter(l => l.player_id === pid && l.log_date === date).length;
  if (!done) throw new Error('Check off at least one drill first');
  if (dayClosed(pid, date)) throw new Error('Already saved.');
  const ids = new Set(plansFor(pid, date).map(p => p.id));
  const total = s.plan_items.filter(i => ids.has(i.plan_id)).length;
  const perfect = total > 0 && done >= total;
  s.training_days.push({ player_id: pid, log_date: date, perfect }); save();
  return tick(perfect);
}

const demoVideos = new Map();   // object URLs live only for this page load

export async function uploadProof(pid, logId, file) {
  const path = `${pid}/${logId}-${Date.now()}`;
  demoVideos.set(path, URL.createObjectURL(file));
  s.drill_logs.find(l => l.id === logId).video_path = path; save();
  return tick(path);
}

export async function videoUrl(_bucket, path) {
  return tick(demoVideos.get(path) || null);
}

export async function getTeamBoard(teamId, today, fromPlayerId) {
  const monday = mondayOf(today);
  const team = s.teams.find(t => t.id === teamId);
  const ids = s.team_members.filter(m => m.team_id === teamId).map(m => m.player_id);
  return tick({
    team: { id: team.id, name: team.name, team_goal: team.team_goal },
    players: ids.map(id => s.players.find(p => p.id === id)).map(p => ({ id: p.id, name: name(p), avatar: p.avatar })),
    days: s.training_days.filter(d => ids.includes(d.player_id)).map(d => ({ player_id: d.player_id, log_date: d.log_date })),
    drillsThisWeek: s.drill_logs.filter(l => ids.includes(l.player_id) && l.log_date >= monday).length,
    highFives: s.high_fives.filter(h => ids.includes(h.to_player) && h.log_date === today),
    fromPlayerId,
  });
}

export async function highFive(from, to, date) {
  if (!s.high_fives.some(h => h.from_player === from && h.to_player === to && h.log_date === date)) {
    s.high_fives.push({ from_player: from, to_player: to, log_date: date }); save();
  }
  return tick();
}

// ---------- Coach ----------

export async function listTeams() {
  return tick(s.teams.filter(t => t.coach_id === me())
    .map(t => ({ ...t, memberCount: s.team_members.filter(m => m.team_id === t.id).length })));
}

export async function createTeam(teamName, goal) {
  const t = { id: uuid(), coach_id: me(), name: teamName, team_goal: goal, join_code: Math.random().toString(16).slice(2, 8).toUpperCase() };
  s.teams.push(t); save();
  return tick(t);
}

export async function updateTeam(teamId, fields) {
  Object.assign(s.teams.find(t => t.id === teamId), fields); save();
  return tick();
}

export async function getRoster() {
  const byId = new Map();
  const add = (pid, tag) => {
    const p = s.players.find(x => x.id === pid);
    if (!p) return;
    const row = byId.get(pid) || { id: pid, name: name(p), avatar: p.avatar, teams: [], solo: false };
    if (tag) row.teams.push(tag); else row.solo = true;
    byId.set(pid, row);
  };
  for (const t of s.teams.filter(t => t.coach_id === me())) for (const m of s.team_members.filter(m => m.team_id === t.id)) add(m.player_id, t.name);
  for (const c of s.coach_clients.filter(c => c.coach_id === me())) add(c.player_id, null);
  const ids = [...byId.keys()];
  return tick({ players: [...byId.values()], days: s.training_days.filter(d => ids.includes(d.player_id)) });
}

export async function listDrills() {
  return tick(s.drills.filter(d => d.coach_id === me() && !d.archived)
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)));
}

export async function saveDrill(d) {
  if (d.id) {
    Object.assign(s.drills.find(x => x.id === d.id), d); save();
    return tick(d);
  }
  const row = { id: uuid(), coach_id: me(), archived: false, video_path: null, video_url: null, ...d };
  s.drills.push(row); save();
  return tick(row);
}

export async function archiveDrill(id) {
  s.drills.find(d => d.id === id).archived = true; save();
  return tick();
}

export async function uploadDrillVideo(file) {
  const path = `${me()}/${Date.now()}`;
  demoVideos.set(path, URL.createObjectURL(file));
  return tick(path);
}

export async function listPlans(monday) {
  return tick(s.plans.filter(p => p.coach_id === me() && p.week_start === monday).map(p => ({
    id: p.id, title: p.title, note: p.note, team_id: p.team_id, player_id: p.player_id,
    targetName: p.team_id ? s.teams.find(t => t.id === p.team_id).name : name(s.players.find(x => x.id === p.player_id)),
    items: s.plan_items.filter(i => i.plan_id === p.id).sort((a, b) => a.sort - b.sort).map(i => {
      const drill = s.drills.find(d => d.id === i.drill_id);
      return { id: i.id, reps: i.reps || drill.reps, drill };
    }),
  })));
}

export async function createPlan({ week_start, team_id, player_id, title, note, items }) {
  const p = { id: uuid(), coach_id: me(), week_start, team_id: team_id || null, player_id: player_id || null, title, note };
  s.plans.push(p);
  items.forEach((it, i) => s.plan_items.push({ id: uuid(), plan_id: p.id, drill_id: it.drill_id, reps: it.reps || null, video_required: !!it.video_required, sort: i }));
  save();
  return tick({ id: p.id });
}

export async function deletePlan(id) {
  const itemIds = new Set(s.plan_items.filter(i => i.plan_id === id).map(i => i.id));
  s.plans = s.plans.filter(p => p.id !== id);
  s.plan_items = s.plan_items.filter(i => i.plan_id !== id);
  s.drill_logs = s.drill_logs.filter(l => !itemIds.has(l.plan_item_id));
  save();
  return tick();
}

export async function reviewFeed(sinceIso) {
  const roster = await getRoster();
  const byId = new Map(roster.players.map(p => [p.id, p]));
  return tick(s.drill_logs.filter(l => byId.has(l.player_id) && l.log_date >= sinceIso)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(l => {
      const item = s.plan_items.find(i => i.id === l.plan_item_id);
      const drill = item && s.drills.find(d => d.id === item.drill_id);
      return {
        id: l.id, log_date: l.log_date, video_path: l.video_path, player: byId.get(l.player_id), drill,
        comments: s.comments.filter(c => c.drill_log_id === l.id)
          .map(c => ({ ...c, author: s.profiles.find(p => p.id === c.author_id)?.full_name || 'Coach' })),
      };
    }));
}

export async function addComment(logId, body) {
  const c = { id: uuid(), drill_log_id: logId, author_id: me(), body, created_at: new Date().toISOString() };
  s.comments.push(c); save();
  return tick({ id: c.id });
}
