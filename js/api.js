// Real data layer: talks to Supabase. mock.js exposes the same functions
// for demo mode, so the screens never know which one they're using.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { addDays, mondayOf } from './game.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  // Implicit flow so a confirmation link still works when it's opened on a
  // different phone or computer than the one used to sign up.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

const APP_URL = location.origin + location.pathname;

function check({ data, error }) {
  if (error) throw new Error(friendly(error));
  return data;
}

function friendly(error) {
  const msg = error.message || String(error);
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/duplicate key/i.test(msg)) return 'Already saved.';
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(msg)) return 'Check your email and tap the confirmation link first.';
  return msg;
}

const name = p => p ? `${p.first_name}${p.last_initial ? ' ' + p.last_initial + '.' : ''}` : '';

async function uid() {
  const { data } = await sb.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ---------- Auth ----------

export const isDemo = false;

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  sb.auth.onAuthStateChange((event, session) => cb(session, event));
}

export async function signUp({ email, password, fullName, consent }) {
  check(await sb.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: APP_URL,
      data: { full_name: fullName, consent: consent ? 'true' : 'false' },
    },
  }));
}

export async function signIn({ email, password }) {
  check(await sb.auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  await sb.auth.signOut();
}

export async function sendPasswordReset(email) {
  check(await sb.auth.resetPasswordForEmail(email, { redirectTo: APP_URL }));
}

export async function setNewPassword(password) {
  check(await sb.auth.updateUser({ password }));
}

export async function getProfile() {
  const id = await uid();
  return check(await sb.from('profiles').select('id, full_name, role, coach_code').eq('id', id).single());
}

// ---------- Families ----------

export async function listMyPlayers() {
  const id = await uid();
  const rows = check(await sb.from('players')
    .select('id, first_name, last_initial, avatar, team_members(teams(id, name)), coach_clients(profiles(id, full_name))')
    .eq('parent_id', id).order('created_at'));
  return rows.map(p => ({
    id: p.id, first_name: p.first_name, last_initial: p.last_initial, avatar: p.avatar, name: name(p),
    teams: p.team_members.map(m => m.teams).filter(Boolean),
    coaches: p.coach_clients.map(c => c.profiles).filter(Boolean),
  }));
}

export async function addPlayer({ first_name, last_initial, avatar }) {
  const id = await uid();
  return check(await sb.from('players')
    .insert({ parent_id: id, first_name, last_initial, avatar }).select('id').single());
}

export async function removePlayer(playerId) {
  // Delete their videos first; the database rows cascade on their own.
  const { data: files } = await sb.storage.from('proof-videos').list(playerId, { limit: 1000 });
  if (files?.length) await sb.storage.from('proof-videos').remove(files.map(f => `${playerId}/${f.name}`));
  check(await sb.from('players').delete().eq('id', playerId));
}

export async function joinWithCode(code, playerId) {
  return check(await sb.rpc('join_with_code', { p_code: code, p_player: playerId }));
}

async function teamIdsFor(playerId) {
  const rows = check(await sb.from('team_members').select('team_id').eq('player_id', playerId));
  return rows.map(r => r.team_id);
}

export async function getPlayerWeek(playerId, today) {
  const monday = mondayOf(today);
  const teamIds = await teamIdsFor(playerId);
  const target = `player_id.eq.${playerId}` + (teamIds.length ? `,team_id.in.(${teamIds.join(',')})` : '');

  const [plans, logs, days, countRes] = await Promise.all([
    sb.from('plans')
      .select('id, title, note, team_id, player_id, teams(name), plan_items(id, reps, video_required, sort, drills(id, title, category, reps, instructions, video_url, video_path))')
      .eq('week_start', monday).or(target).order('created_at'),
    sb.from('drill_logs').select('id, plan_item_id, log_date, video_path')
      .eq('player_id', playerId).gte('log_date', monday),
    sb.from('training_days').select('log_date, perfect')
      .eq('player_id', playerId).order('log_date', { ascending: false }).limit(1000),
    sb.from('drill_logs').select('id', { count: 'exact', head: true }).eq('player_id', playerId),
  ]);

  const weekLogs = check(logs);
  const comments = weekLogs.length
    ? check(await sb.from('comments').select('id, drill_log_id, body, created_at, profiles(full_name)')
        .in('drill_log_id', weekLogs.map(l => l.id)).order('created_at'))
    : [];

  return {
    monday,
    plans: check(plans).map(p => ({
      id: p.id, title: p.title, note: p.note,
      teamId: p.team_id, teamName: p.teams?.name ?? null,
      items: p.plan_items.sort((a, b) => a.sort - b.sort).map(i => ({
        id: i.id, reps: i.reps || i.drills.reps, video_required: i.video_required, drill: i.drills,
      })),
    })),
    logs: weekLogs,
    days: check(days),
    drillCount: countRes.count ?? 0,
    comments: comments.map(c => ({ ...c, author: c.profiles?.full_name || 'Coach' })),
  };
}

export async function logDrill(playerId, planItemId, date) {
  return check(await sb.from('drill_logs')
    .insert({ player_id: playerId, plan_item_id: planItemId, log_date: date })
    .select('id, plan_item_id, log_date, video_path').single());
}

export async function unlogDrill(logId) {
  check(await sb.from('drill_logs').delete().eq('id', logId));
}

export async function completeDay(playerId, date) {
  const row = check(await sb.from('training_days')
    .insert({ player_id: playerId, log_date: date }).select('log_date, perfect').single());
  return row.perfect;
}

export async function uploadProof(playerId, logId, file) {
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const path = `${playerId}/${logId}-${Date.now()}.${ext}`;
  check(await sb.storage.from('proof-videos').upload(path, file, { contentType: file.type }));
  check(await sb.from('drill_logs').update({ video_path: path }).eq('id', logId));
  return path;
}

export async function videoUrl(bucket, path) {
  const data = check(await sb.storage.from(bucket).createSignedUrl(path, 3600));
  return data.signedUrl;
}

export async function getTeamBoard(teamId, today, fromPlayerId) {
  const monday = mondayOf(today);
  const [team, members] = await Promise.all([
    sb.from('teams').select('id, name, team_goal').eq('id', teamId).single(),
    sb.from('team_members').select('players(id, first_name, last_initial, avatar)').eq('team_id', teamId),
  ]);
  const players = check(members).map(m => m.players).filter(Boolean);
  const ids = players.map(p => p.id);
  if (!ids.length) return { team: check(team), players: [], days: [], drillsThisWeek: 0, highFives: [] };

  const [days, drillRes, fives] = await Promise.all([
    sb.from('training_days').select('player_id, log_date').in('player_id', ids).gte('log_date', addDays(today, -90)),
    sb.from('drill_logs').select('id', { count: 'exact', head: true }).in('player_id', ids).gte('log_date', monday),
    sb.from('high_fives').select('from_player, to_player').in('to_player', ids).eq('log_date', today),
  ]);
  return {
    team: check(team),
    players: players.map(p => ({ id: p.id, name: name(p), avatar: p.avatar })),
    days: check(days),
    drillsThisWeek: drillRes.count ?? 0,
    highFives: check(fives),
    fromPlayerId,
  };
}

export async function highFive(fromPlayer, toPlayer, date) {
  check(await sb.from('high_fives').insert({ from_player: fromPlayer, to_player: toPlayer, log_date: date }));
}

// ---------- Coach ----------

export async function listTeams() {
  const id = await uid();
  const rows = check(await sb.from('teams').select('id, name, join_code, team_goal, team_members(count)')
    .eq('coach_id', id).order('created_at'));
  return rows.map(t => ({ ...t, memberCount: t.team_members?.[0]?.count ?? 0 }));
}

export async function createTeam(teamName, goal) {
  const id = await uid();
  return check(await sb.from('teams').insert({ coach_id: id, name: teamName, team_goal: goal }).select().single());
}

export async function updateTeam(teamId, fields) {
  check(await sb.from('teams').update(fields).eq('id', teamId));
}

export async function getRoster(today) {
  const id = await uid();
  const [teams, clients] = await Promise.all([
    sb.from('teams').select('id, name, team_members(players(id, first_name, last_initial, avatar))').eq('coach_id', id),
    sb.from('coach_clients').select('players(id, first_name, last_initial, avatar)').eq('coach_id', id),
  ]);
  const byId = new Map();
  const add = (p, tag) => {
    if (!p) return;
    const row = byId.get(p.id) || { id: p.id, name: name(p), avatar: p.avatar, teams: [], solo: false };
    if (tag) row.teams.push(tag); else row.solo = true;
    byId.set(p.id, row);
  };
  for (const t of check(teams)) for (const m of t.team_members) add(m.players, t.name);
  for (const c of check(clients)) add(c.players, null);

  const ids = [...byId.keys()];
  const days = ids.length
    ? check(await sb.from('training_days').select('player_id, log_date').in('player_id', ids).gte('log_date', addDays(today, -90)))
    : [];
  return { players: [...byId.values()], days };
}

export async function listDrills() {
  const id = await uid();
  return check(await sb.from('drills').select('*').eq('coach_id', id).eq('archived', false).order('category').order('title'));
}

export async function saveDrill(d) {
  const id = await uid();
  const fields = {
    category: d.category, title: d.title, reps: d.reps || '', instructions: d.instructions || '',
    video_url: d.video_url || null, video_path: d.video_path || null,
  };
  if (d.id) return check(await sb.from('drills').update(fields).eq('id', d.id).select().single());
  return check(await sb.from('drills').insert({ ...fields, coach_id: id }).select().single());
}

export async function archiveDrill(drillId) {
  check(await sb.from('drills').update({ archived: true }).eq('id', drillId));
}

export async function uploadDrillVideo(file) {
  const id = await uid();
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const path = `${id}/${Date.now()}.${ext}`;
  check(await sb.storage.from('drill-videos').upload(path, file, { contentType: file.type }));
  return path;
}

export async function listPlans(monday) {
  const id = await uid();
  const rows = check(await sb.from('plans')
    .select('id, title, note, team_id, player_id, teams(name), players(first_name, last_initial), plan_items(id, reps, sort, drills(id, title, category, reps))')
    .eq('coach_id', id).eq('week_start', monday).order('created_at'));
  return rows.map(p => ({
    id: p.id, title: p.title, note: p.note, team_id: p.team_id, player_id: p.player_id,
    targetName: p.teams?.name ?? name(p.players),
    items: p.plan_items.sort((a, b) => a.sort - b.sort).map(i => ({ id: i.id, reps: i.reps || i.drills.reps, drill: i.drills })),
  }));
}

export async function createPlan({ week_start, team_id, player_id, title, note, items }) {
  const id = await uid();
  const plan = check(await sb.from('plans')
    .insert({ coach_id: id, week_start, team_id: team_id || null, player_id: player_id || null, title, note })
    .select('id').single());
  if (items.length) {
    const { error } = await sb.from('plan_items').insert(items.map((it, i) => ({
      plan_id: plan.id, drill_id: it.drill_id, reps: it.reps || null, video_required: !!it.video_required, sort: i,
    })));
    if (error) {
      await sb.from('plans').delete().eq('id', plan.id);
      throw new Error(friendly(error));
    }
  }
  return plan;
}

export async function deletePlan(planId) {
  check(await sb.from('plans').delete().eq('id', planId));
}

export async function reviewFeed(sinceIso) {
  const roster = await getRoster(sinceIso);
  const ids = roster.players.map(p => p.id);
  if (!ids.length) return [];
  const rows = check(await sb.from('drill_logs')
    .select('id, log_date, video_path, created_at, player_id, plan_items(drills(title, category)), comments(id, body, created_at, profiles(full_name))')
    .in('player_id', ids).gte('log_date', sinceIso).order('created_at', { ascending: false }).limit(200));
  const names = new Map(roster.players.map(p => [p.id, p]));
  return rows.map(r => ({
    id: r.id, log_date: r.log_date, video_path: r.video_path,
    player: names.get(r.player_id),
    drill: r.plan_items?.drills,
    comments: (r.comments || []).sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(c => ({ ...c, author: c.profiles?.full_name || 'Coach' })),
  }));
}

export async function addComment(logId, body) {
  return check(await sb.from('comments').insert({ drill_log_id: logId, body }).select('id').single());
}
