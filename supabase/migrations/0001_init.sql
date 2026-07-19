-- =====================================================================
-- Padel Session Manager — Phase 1 Supabase schema
-- Scope decision (confirmed): real Supabase auth + database from day one,
-- kept minimal. Only HOSTS get real accounts (Supabase `auth.users`).
-- Players joining a session for Phase 1 are name-only rows in `players`
-- with a nullable `linked_user_id` so Phase 2 can attach a real account
-- later without a schema migration.
-- =====================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- TEAMS  (Phase 1 = exactly one team per host, modeled separately so
-- Phase 2 multi-team/clubs doesn't require restructuring)
-- ---------------------------------------------------------------------
create table teams (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SESSIONS
-- ---------------------------------------------------------------------
create table sessions (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references teams(id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  format           text not null check (format in
                     ('americano','mexicano','mix_americano','mix_mexicano',
                      'fixed_partner','team_sparring')),
  scoring_format   text not null check (scoring_format in
                     ('fixed_21','fixed_4_games','fixed_5_games','race_4','race_6')),
  ranking_basis    text not null check (ranking_basis in ('points_first','wins_first')),
  status           text not null default 'draft' check (status in ('draft','live','ended')),
  join_code        char(6) not null unique,          -- 6-digit numeric host/player join code
  public_token     text not null unique,              -- long unguessable token for read-only public link
  scheduling_seed  bigint not null,                    -- stored seed for deterministic round-1 randomization
  min_players_per_court int not null default 4,        -- correction #4: hard rule, not just a soft target
  created_by       uuid not null references auth.users(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  started_at       timestamptz,
  ended_at         timestamptz
);
create index on sessions (created_by);
create index on sessions (public_token);

-- ---------------------------------------------------------------------
-- COURTS
-- ---------------------------------------------------------------------
create table courts (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  ordinal       int not null,
  display_name  text not null,
  available     boolean not null default true,
  unique (session_id, ordinal)
);

-- ---------------------------------------------------------------------
-- PLAYERS  (name-only for Phase 1; linked_user_id is future-proofing)
-- ---------------------------------------------------------------------
create table players (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sessions(id) on delete cascade,
  display_name     text not null,
  gender           char(1) not null default 'M' check (gender in ('M','F')), -- correction #3: defaults Male, only *required* for mixed formats
  linked_user_id   uuid references auth.users(id),      -- null in Phase 1 unless player chose to sign in
  team_side        char(1) check (team_side in ('A','B')), -- Team Sparring only
  status           text not null default 'active' check (status in ('active','late','left')),
  matches_played   int not null default 0,
  rests            int not null default 0,
  joined_at        timestamptz not null default now(),
  left_at          timestamptz
);
create index on players (session_id);

-- ---------------------------------------------------------------------
-- PAIRS  (Fixed Partner + Team Sparring "fixed partners" sub-mode)
-- correction #9: pairs are a first-class unit, shown as "AB vs CD"
-- ---------------------------------------------------------------------
create table pairs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  label         text not null,          -- auto "AB" from initials, host-renamable
  is_auto_label boolean not null default true,
  team_side     char(1) check (team_side in ('A','B')), -- Team Sparring fixed-pairs only
  player_a_id   uuid not null references players(id) on delete cascade,
  player_b_id   uuid not null references players(id) on delete cascade,
  created_at    timestamptz not null default now(),
  check (player_a_id <> player_b_id)
);
create index on pairs (session_id);

-- ---------------------------------------------------------------------
-- ROUNDS
-- ---------------------------------------------------------------------
create table rounds (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references sessions(id) on delete cascade,
  sequence           int not null,
  status             text not null default 'planned'
                      check (status in ('planned','in_progress','scored','superseded')),
  generation_reason  text not null,     -- immutable, human-readable ("initial draw", "regenerated: player X left", ...)
  seed_used          bigint not null,
  generated_at       timestamptz not null default now(),
  unique (session_id, sequence)
);

-- players resting a given round (explicit, so "why is X resting" is queryable/auditable)
create table round_rests (
  round_id   uuid not null references rounds(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  consecutive_rest_count int not null default 0, -- diagnostics: flags back-to-back rests
  primary key (round_id, player_id)
);

-- ---------------------------------------------------------------------
-- MATCHES
-- ---------------------------------------------------------------------
create table matches (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references rounds(id) on delete cascade,
  court_id        uuid not null references courts(id),
  -- fixed-pair formats populate pair_a_id/pair_b_id (label comes from `pairs`);
  -- individual formats (Americano/Mexicano) leave these null and rely on match_participants.
  pair_a_id       uuid references pairs(id),
  pair_b_id       uuid references pairs(id),
  score_a         int,
  score_b         int,
  outcome         text check (outcome in ('win_a','win_b','draw','cancelled')),
  status          text not null default 'not_started'
                   check (status in ('not_started','in_progress','final','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (pair_a_id is null or pair_a_id <> pair_b_id)
);
create index on matches (round_id);

-- canonical per-player membership of every match, side A or B — always populated,
-- even for fixed-pair formats, so individual player history/stats never require
-- unwinding a pair.
create table match_participants (
  match_id   uuid not null references matches(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  side       char(1) not null check (side in ('A','B')),
  primary key (match_id, player_id)
);

-- one row per score edit — required by §10 "every score edit stores old/new, editor, time, reason"
create table score_edits (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references matches(id) on delete cascade,
  old_score_a int, old_score_b int,
  new_score_a int, new_score_b int,
  edited_by   uuid not null references auth.users(id),
  reason      text,
  edited_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ADJUSTMENTS  (§5 midpoint compensation — never a win, never head-to-head)
-- ---------------------------------------------------------------------
create table adjustments (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references sessions(id) on delete cascade,
  player_id       uuid references players(id) on delete cascade,
  pair_id         uuid references pairs(id) on delete cascade,
  amount          numeric not null,
  unit            text not null check (unit in ('points','games')),
  reason          text not null,
  applied_by      uuid not null references auth.users(id),
  applied_at      timestamptz not null default now(),
  counts_as_match boolean not null default false,
  check ( (player_id is null) <> (pair_id is null) ) -- exactly one subject
);

-- ---------------------------------------------------------------------
-- STANDINGS  — kept as a VIEW (always live-correct) rather than a stored
-- snapshot table, since Phase 1 has no requirement to freeze historical
-- per-round standings. Phase 2 season rankings can materialize this per
-- session at "ended_at" time instead of duplicating write paths now.
-- ---------------------------------------------------------------------
create view standings_live as
  with player_results as (
    select
      mp.player_id,
      m.session_id_derived as session_id,
      case
        when m.outcome = 'draw' then 0.5
        when (m.outcome = 'win_a' and mp.side = 'A') or (m.outcome = 'win_b' and mp.side = 'B') then 1
        else 0
      end as win_value,
      case when m.outcome = 'draw' then 1 else 0 end as draw_value,
      case
        when m.outcome not in ('draw') and
             ((m.outcome = 'win_a' and mp.side = 'B') or (m.outcome = 'win_b' and mp.side = 'A'))
        then 1 else 0
      end as loss_value,
      case when mp.side = 'A' then m.score_a else m.score_b end as points_value
    from match_participants mp
    join (select matches.*, rounds.session_id as session_id_derived
          from matches join rounds on rounds.id = matches.round_id
          where matches.status = 'final') m on m.id = mp.match_id
  )
  select
    pr.session_id,
    pr.player_id,
    sum(pr.points_value) + coalesce(adj.total_amount, 0) as total_points,
    sum(pr.win_value) as wins,
    sum(pr.draw_value) as draws,
    sum(pr.loss_value) as losses,
    coalesce(adj.total_amount, 0) as adjustment_total
  from player_results pr
  left join (
    select player_id, sum(amount) as total_amount
    from adjustments where player_id is not null
    group by player_id
  ) adj on adj.player_id = pr.player_id
  group by pr.session_id, pr.player_id, adj.total_amount;

-- Fixed Partner / Team Sparring pair-level standings, same shape, keyed by pair.
create view standings_live_pairs as
  with pair_results as (
    select
      m.pair_a_id as pair_id, m.session_id_derived as session_id,
      case when m.outcome='win_a' then 1 when m.outcome='draw' then 0.5 else 0 end as win_value,
      case when m.outcome='draw' then 1 else 0 end as draw_value,
      case when m.outcome='win_b' then 1 else 0 end as loss_value,
      m.score_a as points_value
    from (select matches.*, rounds.session_id as session_id_derived
          from matches join rounds on rounds.id = matches.round_id
          where matches.status='final' and matches.pair_a_id is not null) m
    union all
    select
      m.pair_b_id as pair_id, m.session_id_derived as session_id,
      case when m.outcome='win_b' then 1 when m.outcome='draw' then 0.5 else 0 end as win_value,
      case when m.outcome='draw' then 1 else 0 end as draw_value,
      case when m.outcome='win_a' then 1 else 0 end as loss_value,
      m.score_b as points_value
    from (select matches.*, rounds.session_id as session_id_derived
          from matches join rounds on rounds.id = matches.round_id
          where matches.status='final' and matches.pair_b_id is not null) m
  )
  select
    pr.session_id, pr.pair_id,
    sum(pr.points_value) + coalesce(adj.total_amount,0) as total_points,
    sum(pr.win_value) as wins, sum(pr.draw_value) as draws, sum(pr.loss_value) as losses,
    coalesce(adj.total_amount,0) as adjustment_total
  from pair_results pr
  left join (
    select pair_id, sum(amount) as total_amount from adjustments where pair_id is not null group by pair_id
  ) adj on adj.pair_id = pr.pair_id
  group by pr.session_id, pr.pair_id, adj.total_amount;

-- ---------------------------------------------------------------------
-- AUDIT EVENTS  (generic — covers regenerate, attendance change, etc.
-- score_edits above is the specialized/queryable subset for scores)
-- ---------------------------------------------------------------------
create table audit_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  actor_id    uuid not null references auth.users(id),
  entity_type text not null,   -- 'session' | 'court' | 'player' | 'pair' | 'round' | 'match' | 'adjustment'
  entity_id   uuid not null,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- ROW LEVEL SECURITY
-- Rule: only the host (sessions.created_by) can read/write full detail.
-- Public/spectator access goes through a SECURITY DEFINER function keyed
-- by public_token — never a direct table grant — so email/auth data can
-- never leak through PostgREST even if a policy is misconfigured later.
-- =====================================================================
alter table teams enable row level security;
alter table sessions enable row level security;
alter table courts enable row level security;
alter table players enable row level security;
alter table pairs enable row level security;
alter table rounds enable row level security;
alter table round_rests enable row level security;
alter table matches enable row level security;
alter table match_participants enable row level security;
alter table score_edits enable row level security;
alter table adjustments enable row level security;
alter table audit_events enable row level security;

create or replace function is_session_host(p_session_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from sessions where id = p_session_id and created_by = auth.uid()
  );
$$;

create or replace function is_round_host(p_round_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from rounds r where r.id = p_round_id and is_session_host(r.session_id)
  );
$$;

create or replace function is_match_host(p_match_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from matches m join rounds r on r.id = m.round_id
    where m.id = p_match_id and is_session_host(r.session_id)
  );
$$;

-- Host full read/write on everything scoped to their own sessions.
create policy host_all_sessions on sessions for all
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy host_all_teams on teams for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy host_all_courts on courts for all
  using (is_session_host(session_id)) with check (is_session_host(session_id));
create policy host_all_players on players for all
  using (is_session_host(session_id)) with check (is_session_host(session_id));
create policy host_all_pairs on pairs for all
  using (is_session_host(session_id)) with check (is_session_host(session_id));
create policy host_all_rounds on rounds for all
  using (is_session_host(session_id)) with check (is_session_host(session_id));
create policy host_all_matches on matches for all
  using (is_round_host(round_id)) with check (is_round_host(round_id));
create policy host_all_round_rests on round_rests for all
  using (is_round_host(round_id)) with check (is_round_host(round_id));
create policy host_all_match_participants on match_participants for all
  using (is_match_host(match_id)) with check (is_match_host(match_id));
create policy host_all_score_edits on score_edits for all
  using (is_match_host(match_id)) with check (is_match_host(match_id));
create policy host_all_adjustments on adjustments for all
  using (is_session_host(session_id)) with check (is_session_host(session_id));
create policy host_all_audit on audit_events for all
  using (is_session_host(session_id)) with check (is_session_host(session_id));

-- Public read-only access: a SECURITY DEFINER RPC, NOT a table grant.
-- Returns only what §2/§8 allow — no player.linked_user_id, no auth.users join.
create or replace function get_public_session(p_public_token text)
returns jsonb language plpgsql stable security definer as $$
declare v_session sessions%rowtype; v_result jsonb;
begin
  select * into v_session from sessions where public_token = p_public_token;
  if not found then
    return null;
  end if;
  select jsonb_build_object(
    'session', jsonb_build_object(
      'name', v_session.name, 'format', v_session.format,
      'scoring_format', v_session.scoring_format, 'status', v_session.status
    ),
    'courts', (select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'available', available))
               from courts where session_id = v_session.id),
    'players', (select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'status', status))
                from players where session_id = v_session.id),
    'standings', (select jsonb_agg(to_jsonb(s)) from standings_live s where s.session_id = v_session.id),
    'rounds', (select jsonb_agg(jsonb_build_object('id', id, 'sequence', sequence, 'status', status) order by sequence)
               from rounds where session_id = v_session.id)
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function get_public_session(text) to anon, authenticated;

-- =====================================================================
-- Notes for the build
-- =====================================================================
-- 1. join_code is generated server-side (6 random digits, retry on unique
--    violation) — never derived from public_token, and never exposed on
--    the public page (per §2: only the host-facing join screens show it).
-- 2. scheduling_seed is set once at session creation (e.g. from
--    gen_random_uuid()::text hashed to bigint) and reused by the
--    scheduling engine for every round's tie-break randomization, so a
--    given session always regenerates the same way given the same inputs.
-- 3. min_players_per_court enforces correction #4 at the application layer
--    (checked before allowing status: draft -> live); it's stored on the
--    session so a future "relax this rule" toggle doesn't need a migration.
-- 4. `pairs.label` is auto-set to initials (e.g. "AB") by application code
--    when a pair is created; `is_auto_label` flips to false the moment a
--    host renames it, so re-running the auto-labeler never clobbers a
--    custom name.
