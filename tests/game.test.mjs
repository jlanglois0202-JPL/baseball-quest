// Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, levelInfo, localISO, mondayOf, rankBoard, streak, totalXP, weekDates, xpForDay } from '../js/game.js';

test('local date does not roll over at 7pm Central', () => {
  const evening = new Date(2026, 9, 19, 20, 30); // Oct 19, 8:30pm local
  assert.equal(localISO(evening), '2026-10-19');
});

test('weeks start Monday', () => {
  assert.equal(mondayOf('2026-10-19'), '2026-10-19'); // Monday
  assert.equal(mondayOf('2026-10-25'), '2026-10-19'); // Sunday
  assert.equal(mondayOf('2026-10-26'), '2026-10-26');
  assert.deepEqual(weekDates('2026-10-19').slice(-1), ['2026-10-25']);
  assert.equal(addDays('2026-03-07', 1), '2026-03-08'); // DST weekend
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
});

test('XP: 25 per drill, 50 per day, 100 perfect bonus', () => {
  assert.equal(totalXP({ drillCount: 0, days: [] }), 0);
  assert.equal(totalXP({ drillCount: 1, days: [{ perfect: false }] }), 75);
  assert.equal(totalXP({ drillCount: 6, days: [{ perfect: true }] }), 300);
  assert.equal(xpForDay({ drillsDone: 1, assigned: 6, completed: true }), 75);
  assert.equal(xpForDay({ drillsDone: 6, assigned: 6, completed: true }), 300);
  assert.equal(xpForDay({ drillsDone: 0, assigned: 0, completed: true }), 50);
});

test('levels every 500 XP', () => {
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, pct: 0 });
  assert.equal(levelInfo(499).level, 1);
  assert.equal(levelInfo(500).level, 2);
  assert.equal(levelInfo(750).pct, 50);
});

test('streak survives until the day is over', () => {
  const t = '2026-10-19';
  assert.equal(streak([], t), 0);
  assert.equal(streak(['2026-10-18', '2026-10-17'], t), 2);            // today not done yet
  assert.equal(streak(['2026-10-19', '2026-10-18', '2026-10-17'], t), 3);
  assert.equal(streak(['2026-10-19', '2026-10-17'], t), 1);            // gap breaks it
  assert.equal(streak(['2026-10-16'], t), 0);
});

test('leaderboard ranks effort: days, then streak, then name', () => {
  const r = rankBoard([
    { name: 'Cole', daysThisWeek: 2, streak: 1 },
    { name: 'Ben', daysThisWeek: 4, streak: 0 },
    { name: 'Drew', daysThisWeek: 2, streak: 3 },
    { name: 'Abe', daysThisWeek: 2, streak: 1 },
  ]).map(x => x.name);
  assert.deepEqual(r, ['Ben', 'Drew', 'Abe', 'Cole']);
});
