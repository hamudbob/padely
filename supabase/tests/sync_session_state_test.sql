-- ---------------------------------------------------------------------
-- Regression test for sync_session_state (0061 -> fixed in 0064)
--
-- Run against a THROWAWAY database that has the migrations applied:
--     psql "<connection string>" -f supabase/tests/sync_session_state_test.sql
--
-- Never run this against production or padelier-v2 — it writes and deletes
-- rows under a fixed test session id.
--
-- This is the test that did not exist on 12 Sep 2026, when a host tapped
-- Randomize and every later push raised unique_violation on
-- rounds_session_id_sequence_key. Replication was dead for the rest of the
-- evening, silently, and the night's scores never reached the server.
--
-- Case 1 below fails against 0061 and passes against 0064.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP on
begin;

\set sid   '''5e551000-0000-0000-0000-0000000000ff'''
\set host  '''ffff0000-0000-0000-0000-0000000000ff'''

-- Stand in for the signed-in host. sync_session_state reads auth.uid().
create or replace function auth.uid() returns uuid language sql stable as
  $fn$ select nullif(current_setting('test.uid', true), '')::uuid $fn$;
select set_config('test.uid', :host, false);

insert into profiles (id, display_name) values (:host::uuid, 'Test Host')
  on conflict (id) do nothing;
insert into teams (id, owner_id, name) values (gen_random_uuid(), :host::uuid, 'Test Team')
  on conflict do nothing;

delete from sessions where id = :sid::uuid;
insert into sessions (id, team_id, created_by, name, format, scoring_format,
                      ranking_basis, status, join_code, public_token, scheduling_seed)
  select :sid::uuid, t.id, :host::uuid, 'Sync test', 'americano', 'best_of_4',
         'points_first', 'live', '000001', 'tok-sync-test', 1
    from teams t where t.owner_id = :host::uuid limit 1;

insert into courts (id, session_id, ordinal, display_name)
  values ('c0000000-0000-0000-0000-0000000000ff', :sid::uuid, 1, 'Court 1');
insert into rounds (id, session_id, sequence, status, generation_reason, seed_used)
  values ('40000000-0000-0000-0000-0000000000f1', :sid::uuid, 1, 'scored', 'initial', 1),
         ('40000000-0000-0000-0000-0000000000f2', :sid::uuid, 2, 'scored', 'next', 2);
insert into matches (id, round_id, court_id, score_a, score_b, outcome, status)
  values ('30000000-0000-0000-0000-0000000000f1','40000000-0000-0000-0000-0000000000f1',
          'c0000000-0000-0000-0000-0000000000ff', 12, 9, 'win_a', 'final');

-- ── 1. Randomize: round 2 comes back with a NEW id at the SAME sequence ──
-- Against 0061 this raises:
--   duplicate key value violates unique constraint "rounds_session_id_sequence_key"
select sync_session_state(format($$ {
  "session": {"id": %s, "status": "live"},
  "courts": [], "players": [], "pairs": [], "rests": [], "participants": [],
  "rounds": [ {"id":"40000000-0000-0000-0000-0000000000f1","sequence":1,"status":"scored"},
              {"id":"49999999-9999-9999-9999-9999999999ff","sequence":2,"status":"planned"} ],
  "matches": []
} $$, :sid)::jsonb);

do $$ begin
  if (select count(*) from rounds where session_id = '5e551000-0000-0000-0000-0000000000ff') <> 2
     or not exists (select 1 from rounds where id = '49999999-9999-9999-9999-9999999999ff') then
    raise exception 'FAIL 1: randomized round did not replace the old one';
  end if;
  raise notice 'PASS 1  randomize replaces the round without aborting the push';
end $$;

-- ── 2. A recorded score survives a payload that is silent about it ───────
select sync_session_state(format($$ {
  "session": {"id": %s, "status": "live"},
  "courts": [], "players": [], "pairs": [], "rests": [], "participants": [],
  "rounds": [ {"id":"40000000-0000-0000-0000-0000000000f1","sequence":1} ],
  "matches": [ {"id":"30000000-0000-0000-0000-0000000000f1",
                "round_id":"40000000-0000-0000-0000-0000000000f1",
                "court_id":"c0000000-0000-0000-0000-0000000000ff",
                "status":"not_started"} ]
} $$, :sid)::jsonb);

do $$ begin
  if (select score_a from matches where id = '30000000-0000-0000-0000-0000000000f1') is distinct from 12 then
    raise exception 'FAIL 2: a local null erased a recorded score';
  end if;
  raise notice 'PASS 2  a local null does not erase a recorded score';
end $$;

-- ── 3. A sequence the payload never mentions is left alone ──────────────
insert into rounds (id, session_id, sequence, status, generation_reason, seed_used)
  values ('40000000-0000-0000-0000-0000000000f3', :sid::uuid, 3, 'planned', 'next', 3);

select sync_session_state(format($$ {
  "session": {"id": %s, "status": "live"},
  "courts": [], "players": [], "pairs": [], "rests": [], "participants": [], "matches": [],
  "rounds": [ {"id":"40000000-0000-0000-0000-0000000000f3","sequence":3} ]
} $$, :sid)::jsonb);

do $$ begin
  if not exists (select 1 from rounds where id = '40000000-0000-0000-0000-0000000000f1') then
    raise exception 'FAIL 3: a partial push deleted history it never mentioned';
  end if;
  raise notice 'PASS 3  a partial push leaves unmentioned rounds alone';
end $$;

rollback;  -- the test leaves nothing behind
