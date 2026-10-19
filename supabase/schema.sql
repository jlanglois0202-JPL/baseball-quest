-- =====================================================================
-- Baseball Quest: database setup
-- Run once in the Supabase SQL Editor on a fresh project.
--
-- Who can see what:
--   * A parent sees their own kids, plus teammates' first name / last
--     initial / avatar and whether they trained (for the leaderboard).
--   * A coach sees the players on his teams and his 1-on-1 clients.
--   * Proof videos and comments: only the player's family and coach.
--     Teammates never see another kid's video.
--   * 1-on-1 plans are visible only to that player's family and coach.
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text not null default '',
  role        text not null default 'parent' check (role in ('parent', 'coach')),
  coach_code  text unique,               -- 1-on-1 invite code (coaches only)
  consent_at  timestamptz,               -- parent agreed to the privacy notice (COPPA)
  created_at  timestamptz not null default now()
);

create table public.players (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid not null references public.profiles on delete cascade,
  first_name    text not null check (char_length(first_name) between 1 and 24),
  last_initial  text not null default '' check (char_length(last_initial) <= 1),
  avatar        text not null default '⚾' check (char_length(avatar) <= 8),
  created_at    timestamptz not null default now()
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.profiles on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  join_code   text not null unique default upper(substr(md5(random()::text), 1, 6)),
  team_goal   int  not null default 500 check (team_goal > 0),  -- weekly Team Quest goal (drills)
  created_at  timestamptz not null default now()
);

create table public.team_members (
  team_id    uuid not null references public.teams on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (team_id, player_id)
);

create table public.coach_clients (
  coach_id   uuid not null references public.profiles on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (coach_id, player_id)
);

create table public.drills (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null references public.profiles on delete cascade,
  category      text not null check (category in ('Hitting', 'Infield', 'Outfield', 'Athleticism')),
  title         text not null check (char_length(title) between 1 and 80),
  reps          text not null default '',
  instructions  text not null default '',
  video_path    text,                    -- file in the drill-videos bucket
  video_url     text,                    -- or an outside link (YouTube, etc.)
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- A weekly plan goes to exactly one team OR one 1-on-1 player.
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.profiles on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),  -- Monday
  team_id     uuid references public.teams on delete cascade,
  player_id   uuid references public.players on delete cascade,
  title       text not null default '',
  note        text not null default '',
  created_at  timestamptz not null default now(),
  check ((team_id is null) <> (player_id is null))
);

create table public.plan_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.plans on delete cascade,
  drill_id        uuid not null references public.drills on delete restrict,
  reps            text,                  -- overrides the drill's default reps
  video_required  boolean not null default false,
  sort            int not null default 0
);

-- One row per drill a player checked off on a given day.
-- The unique key is what stops double XP from repeat taps.
create table public.drill_logs (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players on delete cascade,
  plan_item_id  uuid not null references public.plan_items on delete cascade,
  log_date      date not null,           -- the player's local date
  video_path    text,                    -- file in the proof-videos bucket
  created_at    timestamptz not null default now(),
  unique (player_id, plan_item_id, log_date)
);

-- "Complete today's training." One drill is enough; perfect is set by the server.
create table public.training_days (
  player_id   uuid not null references public.players on delete cascade,
  log_date    date not null,
  perfect     boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (player_id, log_date)
);

-- Coach feedback on a logged drill (family and coach only).
create table public.comments (
  id            uuid primary key default gen_random_uuid(),
  drill_log_id  uuid not null references public.drill_logs on delete cascade,
  author_id     uuid not null default auth.uid() references public.profiles on delete cascade,
  body          text not null check (char_length(body) between 1 and 1000),
  created_at    timestamptz not null default now()
);

-- Teammates can high-five a finished training day. No free text between kids.
create table public.high_fives (
  from_player  uuid not null references public.players on delete cascade,
  to_player    uuid not null,
  log_date     date not null,
  created_at   timestamptz not null default now(),
  primary key (from_player, to_player, log_date),
  foreign key (to_player, log_date) references public.training_days on delete cascade,
  check (from_player <> to_player)
);

create index on public.players (parent_id);
create index on public.team_members (player_id);
create index on public.coach_clients (player_id);
create index on public.plans (team_id, week_start);
create index on public.plans (player_id, week_start);
create index on public.plan_items (plan_id);
create index on public.drill_logs (player_id, log_date);
create index on public.comments (drill_log_id);

-- ---------- Helper functions (used by the access rules) ---------------

create function public.is_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach');
$$;

create function public.has_consent() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and consent_at is not null);
$$;

create function public.is_my_player(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.players where id = p and parent_id = auth.uid());
$$;

create function public.coaches_player(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members tm
                 join public.teams t on t.id = tm.team_id
                 where tm.player_id = p and t.coach_id = auth.uid())
      or exists (select 1 from public.coach_clients cc
                 where cc.player_id = p and cc.coach_id = auth.uid());
$$;

create function public.my_team_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select tm.team_id from public.team_members tm
  join public.players pl on pl.id = tm.player_id
  where pl.parent_id = auth.uid();
$$;

create function public.shares_team(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members tm
                 where tm.player_id = p and tm.team_id in (select public.my_team_ids()));
$$;

create function public.can_see_player(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_my_player(p) or public.coaches_player(p) or public.shares_team(p);
$$;

-- Family or coach (not teammates): for videos and comments.
create function public.is_family_or_coach(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_my_player(p) or public.coaches_player(p);
$$;

create function public.connected_to_coach(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select c = auth.uid()
      or exists (select 1 from public.teams t
                 where t.coach_id = c and t.id in (select public.my_team_ids()))
      or exists (select 1 from public.coach_clients cc
                 join public.players pl on pl.id = cc.player_id
                 where cc.coach_id = c and pl.parent_id = auth.uid());
$$;

-- Plans assigned to a player for the week containing p_date.
create function public.plans_for(p_player uuid, p_date date) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select pl.id from public.plans pl
  where pl.week_start = date_trunc('week', p_date)::date
    and (pl.player_id = p_player
         or exists (select 1 from public.team_members tm
                    where tm.team_id = pl.team_id and tm.player_id = p_player));
$$;

create function public.item_assigned(p_item uuid, p_player uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan_items i
                 where i.id = p_item and i.plan_id in (select public.plans_for(p_player, p_date)));
$$;

create function public.day_is_closed(p_player uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.training_days where player_id = p_player and log_date = p_date);
$$;

create function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- ---------- Triggers --------------------------------------------------

-- New sign-up -> profile row. Consent comes from the sign-up form.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, consent_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when (new.raw_user_meta_data ->> 'consent') = 'true' then now() end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Completing a day needs at least one drill; perfect = every assigned drill done.
create function public.training_day_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  done_count  int;
  total_count int;
begin
  select count(*) into done_count from public.drill_logs
  where player_id = new.player_id and log_date = new.log_date;

  if done_count = 0 then
    raise exception 'Check off at least one drill first';
  end if;

  select count(*) into total_count from public.plan_items
  where plan_id in (select public.plans_for(new.player_id, new.log_date));

  new.perfect := total_count > 0 and done_count >= total_count;
  new.created_at := now();
  return new;
end $$;

create trigger training_day_before_insert
  before insert on public.training_days
  for each row execute function public.training_day_before_insert();

-- ---------- Join a team or a coach with a code -------------------------

create function public.join_with_code(p_code text, p_player uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_team  public.teams;
  v_coach public.profiles;
begin
  if not public.is_my_player(p_player) then
    raise exception 'That player is not on your account';
  end if;

  select * into v_team from public.teams where join_code = upper(trim(p_code));
  if found then
    insert into public.team_members (team_id, player_id)
    values (v_team.id, p_player) on conflict do nothing;
    return 'Joined ' || v_team.name;
  end if;

  select * into v_coach from public.profiles
  where coach_code = upper(trim(p_code)) and role = 'coach';
  if found then
    insert into public.coach_clients (coach_id, player_id)
    values (v_coach.id, p_player) on conflict do nothing;
    return 'Now training 1-on-1 with ' || coalesce(nullif(v_coach.full_name, ''), 'your coach');
  end if;

  raise exception 'That code does not match a team or coach';
end $$;

-- ---------- Admin: turn an account into a coach -----------------------
-- Run in the SQL Editor after the coach signs up:
--   select public.setup_coach('coach@example.com');
-- Loads the starter drills from the original Baseball Quest prototype.

create function public.setup_coach(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'No account with that email yet. Have the coach sign up first.';
  end if;

  update public.profiles
  set role = 'coach',
      coach_code = coalesce(coach_code, upper(substr(md5(random()::text), 1, 6)))
  where id = v_uid;

  if not exists (select 1 from public.drills where coach_id = v_uid) then
    insert into public.drills (coach_id, category, title, reps) values
      (v_uid, 'Hitting',     'Addressing the Plate',            '10 reps'),
      (v_uid, 'Hitting',     'Load & Separate',                 '10 reps'),
      (v_uid, 'Hitting',     'Dry Swings',                      '10–20 dry swings'),
      (v_uid, 'Hitting',     'Tee Swings',                      '25–50 swings'),
      (v_uid, 'Infield',     'Knee Drills (1-H / 2-H / B)',     '10 for each glove position'),
      (v_uid, 'Infield',     'Foot Placement (Shuffle)',        '10 shuffles'),
      (v_uid, 'Infield',     'Crossover',                       '10 angle creators'),
      (v_uid, 'Infield',     'Shuffle',                         '10 angle creators'),
      (v_uid, 'Outfield',    'Organic Drop Step L/R',           '10 per day'),
      (v_uid, 'Outfield',    'Head Snaps',                      '10 per day'),
      (v_uid, 'Outfield',    'Defensive Back Hips (DB Hips)',   '10 per day'),
      (v_uid, 'Outfield',    'False Steps',                     '10 per day'),
      (v_uid, 'Athleticism', 'Lunges',                          '5 rounds × 10 reps'),
      (v_uid, 'Athleticism', 'Burpees',                         '5 rounds × 10 reps'),
      (v_uid, 'Athleticism', 'Body Squats',                     '5 rounds × 10 reps'),
      (v_uid, 'Athleticism', 'Jump Squats',                     '5 rounds × 10 reps'),
      (v_uid, 'Athleticism', 'Push Ups',                        '35–50 reps'),
      (v_uid, 'Athleticism', 'Plank Hold',                      '45 sec × 4 rounds'),
      (v_uid, 'Athleticism', 'Mountain Climbers',               '45 sec × 4 rounds'),
      (v_uid, 'Athleticism', 'Sit Ups',                         '80–100 reps');
  end if;

  return 'Coach ready. 1-on-1 invite code: '
         || (select coach_code from public.profiles where id = v_uid);
end $$;

-- ---------- Row Level Security -----------------------------------------

alter table public.profiles      enable row level security;
alter table public.players       enable row level security;
alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.coach_clients enable row level security;
alter table public.drills        enable row level security;
alter table public.plans         enable row level security;
alter table public.plan_items    enable row level security;
alter table public.drill_logs    enable row level security;
alter table public.training_days enable row level security;
alter table public.comments      enable row level security;
alter table public.high_fives    enable row level security;

-- profiles
create policy "see self, coaches, and parents of my players" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or role = 'coach'
    or exists (select 1 from public.players p
               where p.parent_id = profiles.id and public.coaches_player(p.id))
  );
create policy "update own name" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- players
create policy "see my kids, teammates, my athletes" on public.players
  for select to authenticated using (parent_id = auth.uid() or public.can_see_player(id));
create policy "parents add kids after consent" on public.players
  for insert to authenticated with check (parent_id = auth.uid() and public.has_consent());
create policy "parents edit own kids" on public.players
  for update to authenticated using (parent_id = auth.uid()) with check (parent_id = auth.uid());
create policy "parents remove own kids" on public.players
  for delete to authenticated using (parent_id = auth.uid());

-- teams
create policy "coach and member families see team" on public.teams
  for select to authenticated using (coach_id = auth.uid() or id in (select public.my_team_ids()));
create policy "coach creates teams" on public.teams
  for insert to authenticated with check (coach_id = auth.uid() and public.is_coach());
create policy "coach edits teams" on public.teams
  for update to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "coach deletes teams" on public.teams
  for delete to authenticated using (coach_id = auth.uid());

-- team_members (joining happens through join_with_code)
create policy "coach and teammates see roster" on public.team_members
  for select to authenticated using (
    team_id in (select public.my_team_ids())
    or exists (select 1 from public.teams t where t.id = team_id and t.coach_id = auth.uid())
  );
create policy "coach or parent removes a player" on public.team_members
  for delete to authenticated using (
    public.is_my_player(player_id)
    or exists (select 1 from public.teams t where t.id = team_id and t.coach_id = auth.uid())
  );

-- coach_clients (joining happens through join_with_code)
create policy "coach and family see 1-on-1 link" on public.coach_clients
  for select to authenticated using (coach_id = auth.uid() or public.is_my_player(player_id));
create policy "coach or parent ends 1-on-1" on public.coach_clients
  for delete to authenticated using (coach_id = auth.uid() or public.is_my_player(player_id));

-- drills
create policy "connected families see coach drills" on public.drills
  for select to authenticated using (public.connected_to_coach(coach_id));
create policy "coach adds drills" on public.drills
  for insert to authenticated with check (coach_id = auth.uid() and public.is_coach());
create policy "coach edits drills" on public.drills
  for update to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "coach deletes drills" on public.drills
  for delete to authenticated using (coach_id = auth.uid());

-- plans
create policy "coach and assigned families see plans" on public.plans
  for select to authenticated using (
    coach_id = auth.uid()
    or team_id in (select public.my_team_ids())
    or public.is_my_player(player_id)
  );
create policy "coach writes plans for own teams and clients" on public.plans
  for insert to authenticated with check (
    coach_id = auth.uid() and public.is_coach() and (
      exists (select 1 from public.teams t where t.id = team_id and t.coach_id = auth.uid())
      or exists (select 1 from public.coach_clients cc
                 where cc.player_id = plans.player_id and cc.coach_id = auth.uid())
    )
  );
create policy "coach edits plans" on public.plans
  for update to authenticated using (coach_id = auth.uid()) with check (
    coach_id = auth.uid() and (
      exists (select 1 from public.teams t where t.id = team_id and t.coach_id = auth.uid())
      or exists (select 1 from public.coach_clients cc
                 where cc.player_id = plans.player_id and cc.coach_id = auth.uid())
    )
  );
create policy "coach deletes plans" on public.plans
  for delete to authenticated using (coach_id = auth.uid());

-- plan_items
create policy "see items of visible plans" on public.plan_items
  for select to authenticated using (exists (select 1 from public.plans p where p.id = plan_id));
create policy "coach adds own drills to own plans" on public.plan_items
  for insert to authenticated with check (
    exists (select 1 from public.plans p where p.id = plan_id and p.coach_id = auth.uid())
    and exists (select 1 from public.drills d where d.id = drill_id and d.coach_id = auth.uid())
  );
create policy "coach edits items" on public.plan_items
  for update to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id and p.coach_id = auth.uid()))
  with check (
    exists (select 1 from public.plans p where p.id = plan_id and p.coach_id = auth.uid())
    and exists (select 1 from public.drills d where d.id = drill_id and d.coach_id = auth.uid())
  );
create policy "coach removes items" on public.plan_items
  for delete to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id and p.coach_id = auth.uid()));

-- drill_logs: today or yesterday only (local-date slack), assigned drills only
create policy "see logs of visible players" on public.drill_logs
  for select to authenticated using (public.can_see_player(player_id));
create policy "family checks off assigned drills" on public.drill_logs
  for insert to authenticated with check (
    public.is_my_player(player_id)
    and log_date between current_date - 1 and current_date + 1
    and public.item_assigned(plan_item_id, player_id, log_date)
    and not public.day_is_closed(player_id, log_date)
  );
create policy "family attaches proof video" on public.drill_logs
  for update to authenticated
  using (public.is_my_player(player_id))
  with check (public.is_my_player(player_id));
create policy "family unchecks before the day is completed" on public.drill_logs
  for delete to authenticated using (
    public.is_my_player(player_id) and not public.day_is_closed(player_id, log_date)
  );

-- training_days: insert only; a completed day can't be undone
create policy "see days of visible players" on public.training_days
  for select to authenticated using (public.can_see_player(player_id));
create policy "family completes today" on public.training_days
  for insert to authenticated with check (
    public.is_my_player(player_id)
    and log_date between current_date - 1 and current_date + 1
  );

-- comments
create policy "family and coach read comments" on public.comments
  for select to authenticated using (
    exists (select 1 from public.drill_logs l
            where l.id = drill_log_id and public.is_family_or_coach(l.player_id))
  );
create policy "family and coach write comments" on public.comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (select 1 from public.drill_logs l
                where l.id = drill_log_id and public.is_family_or_coach(l.player_id))
  );
create policy "delete own comments" on public.comments
  for delete to authenticated using (author_id = auth.uid());

-- high_fives
create policy "see high fives for visible players" on public.high_fives
  for select to authenticated using (public.can_see_player(to_player));
create policy "high five a teammate" on public.high_fives
  for insert to authenticated with check (
    public.is_my_player(from_player)
    and exists (select 1 from public.team_members a
                join public.team_members b on a.team_id = b.team_id
                where a.player_id = from_player and b.player_id = to_player)
  );
create policy "take back a high five" on public.high_fives
  for delete to authenticated using (public.is_my_player(from_player));

-- ---------- Grants (new tables are not exposed automatically) ----------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;   -- can't self-promote to coach
revoke insert, delete on public.profiles from authenticated;    -- created by the sign-up trigger
revoke insert on public.team_members, public.coach_clients from authenticated;  -- join_with_code only
revoke update on public.team_members, public.coach_clients, public.training_days,
                 public.comments, public.high_fives from authenticated;
revoke update on public.drill_logs from authenticated;
grant update (video_path) on public.drill_logs to authenticated;

-- Helpers the access rules call, plus the join function.
grant execute on function
  public.is_coach(), public.has_consent(), public.is_my_player(uuid),
  public.coaches_player(uuid), public.my_team_ids(), public.shares_team(uuid),
  public.can_see_player(uuid), public.is_family_or_coach(uuid),
  public.connected_to_coach(uuid), public.plans_for(uuid, date),
  public.item_assigned(uuid, uuid, date), public.day_is_closed(uuid, date),
  public.try_uuid(text), public.join_with_code(text, uuid)
to authenticated;
-- setup_coach stays admin-only (SQL Editor).

-- ---------- Video storage ----------------------------------------------
-- proof-videos/<player_id>/<file>   short clips, family + coach only (25 MB cap)
-- drill-videos/<coach_id>/<file>    coach demo videos (100 MB cap)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('proof-videos', 'proof-videos', false, 26214400,  array['video/mp4', 'video/quicktime', 'video/webm']),
  ('drill-videos', 'drill-videos', false, 104857600, array['video/mp4', 'video/quicktime', 'video/webm']);

create policy "proof: family uploads" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'proof-videos'
    and public.is_my_player(public.try_uuid((storage.foldername(name))[1]))
  );
create policy "proof: family and coach watch" on storage.objects
  for select to authenticated using (
    bucket_id = 'proof-videos'
    and public.is_family_or_coach(public.try_uuid((storage.foldername(name))[1]))
  );
create policy "proof: family and coach delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'proof-videos'
    and public.is_family_or_coach(public.try_uuid((storage.foldername(name))[1]))
  );

create policy "drills: coach uploads" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'drill-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_coach()
  );
create policy "drills: connected families watch" on storage.objects
  for select to authenticated using (
    bucket_id = 'drill-videos'
    and public.connected_to_coach(public.try_uuid((storage.foldername(name))[1]))
  );
create policy "drills: coach deletes" on storage.objects
  for delete to authenticated using (
    bucket_id = 'drill-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
