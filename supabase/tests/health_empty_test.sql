\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@t'),('22222222-2222-2222-2222-222222222222','b@t');
update profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';
insert into teams (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','T');
insert into clubs (id, name, club_code) values ('a1000000-0000-0000-0000-000000000001','C','C00001');
insert into club_members (club_id,user_id,role) values ('a1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','member') on conflict do nothing;
-- 1 empty (linked, no matches)   2 played (linked, scored)
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed, created_by, ended_at)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Empty','mexicano','fixed_21','points_first','ended','100001','t1',1,'11111111-1111-1111-1111-111111111111',now()),
       ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Played','mexicano','fixed_21','points_first','ended','100002','t2',1,'11111111-1111-1111-1111-111111111111',now());
insert into players (id, session_id, display_name, linked_user_id) values
 ('d0000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','B','22222222-2222-2222-2222-222222222222'),
 ('d0000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','B','22222222-2222-2222-2222-222222222222');
insert into rounds (id, session_id, sequence, status, generation_reason, seed_used) values ('eeeeeeee-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002',1,'scored','x',1);
insert into courts (id, session_id, ordinal, display_name) values ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002',1,'C1');
insert into matches (round_id, court_id, status, score_a, score_b, outcome) values ('eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002','final',15,6,'win_a');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) is not null;
select case when (select (x->>'count')::int from jsonb_array_elements(admin_health()) x where x->>'key'='sessions_unrated') = 1
             and (select x->'sample'->0->>'name' from jsonb_array_elements(admin_health()) x where x->>'key'='sessions_unrated') = 'Played'
       then 'PASS  unrated lists only the played night' else 'FAIL  unrated' end;
select case when (select (x->>'count')::int from jsonb_array_elements(admin_health()) x where x->>'key'='sessions_results_missing') = 1
       then 'PASS  league check lists only the played night' else 'FAIL  league' end;
