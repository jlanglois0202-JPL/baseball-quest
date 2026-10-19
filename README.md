# Baseball Quest

Offseason training quests for youth baseball. A coach posts weekly drills to a
team or to a 1-on-1 player; players check them off, earn XP, keep streaks, and
see their teammates putting in the work.

- **Live app:** https://jlanglois0202-jpl.github.io/baseball-quest/
- **Demo with sample data (no account):** add `?demo` to the URL
- **Original prototype:** `prototype-v1` branch

## How it's built

Plain HTML/CSS/JavaScript with no build step, hosted on GitHub Pages.
Accounts, data and videos live in Supabase.

| File | What it does |
|---|---|
| `index.html`, `css/app.css` | Page shell and styles |
| `js/app.js` | All screens (parent, player, coach) |
| `js/game.js` | XP, levels, streaks, week dates |
| `js/api.js` | Talks to Supabase |
| `js/mock.js` | Same functions with sample data, for `?demo` |
| `js/config.js` | Supabase URL + publishable key (safe to be public) |
| `supabase/schema.sql` | Database tables, privacy rules, video storage |
| `lib/supabase.js` | Supabase client library (v2.117.2) |

## Scoring

25 XP per drill · 50 XP for completing a training day (one drill is enough) ·
100 XP bonus for doing every assigned drill · a new level every 500 XP.
The leaderboard ranks days trained this week, then streak, and resets Mondays.

## Making someone a coach

Have them sign up in the app, then run this in the Supabase SQL Editor:

```sql
select public.setup_coach('coach@example.com');
```

It also loads the starter drill library and returns their 1-on-1 invite code.

## Tests

```sh
node --test tests/*.test.mjs
```
