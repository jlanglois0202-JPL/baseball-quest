// Scoring rules and date helpers. No DOM, no network: easy to test.

export const XP_PER_DRILL = 25;
export const XP_PER_DAY = 50;          // finishing a training day (1+ drill)
export const XP_PERFECT_BONUS = 100;   // every assigned drill that day
export const XP_PER_LEVEL = 500;

export const CATEGORIES = ['Hitting', 'Infield', 'Outfield', 'Athleticism'];

// Dates are the player's *local* calendar day as "YYYY-MM-DD".
// (The prototype used UTC, which rolled the day over at 7pm Central.)
export function localISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return localISO(d);
}

// Weeks run Monday to Sunday, matching plans.week_start in the database.
export function mondayOf(iso) {
  const d = parseISO(iso);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return localISO(d);
}

export function weekDates(mondayIso) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayIso, i));
}

export function totalXP({ drillCount, days }) {
  const perfect = days.filter(d => d.perfect).length;
  return drillCount * XP_PER_DRILL + days.length * XP_PER_DAY + perfect * XP_PERFECT_BONUS;
}

export function levelInfo(xp) {
  return {
    level: Math.floor(xp / XP_PER_LEVEL) + 1,
    into: xp % XP_PER_LEVEL,
    pct: Math.round(((xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100),
  };
}

// Consecutive training days ending today. Today not done yet doesn't break
// the streak, so a player who trained yesterday still sees it alive.
export function streak(dayIsos, todayIso) {
  const set = new Set(dayIsos);
  let d = set.has(todayIso) ? todayIso : addDays(todayIso, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// Effort leaderboard: days trained this week, then streak, then name.
export function rankBoard(rows) {
  return [...rows].sort((a, b) =>
    b.daysThisWeek - a.daysThisWeek ||
    b.streak - a.streak ||
    a.name.localeCompare(b.name));
}

export function xpForDay({ drillsDone, assigned, completed }) {
  if (!completed) return drillsDone * XP_PER_DRILL;
  const perfect = assigned > 0 && drillsDone >= assigned;
  return drillsDone * XP_PER_DRILL + XP_PER_DAY + (perfect ? XP_PERFECT_BONUS : 0);
}
