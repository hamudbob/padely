\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@t');
update profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';
insert into teams (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','T');
insert into sessions (id, team_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Night','mexicano','fixed_21','points_first','ended','100001','t1',1,'11111111-1111-1111-1111-111111111111');
insert into players (id, session_id, display_name) select ('d0000000-0000-0000-0000-00000000000'||g)::uuid, 'bbbbbbbb-0000-0000-0000-000000000001', 'P'||g from generate_series(1,5) g;
insert into courts (id, session_id, ordinal, display_name) values ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1,'C1');
insert into rounds (id, session_id, sequence, status, generation_reason, seed_used) values
 ('eeeeeeee-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1,'scored','x',1),
 ('eeeeeeee-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001',2,'scored','x',1);
insert into matches (id, round_id, court_id, status, score_a, score_b, outcome) values
 ('ffffffff-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','final',15,6,'win_a'),
 ('ffffffff-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001','final',10,11,'win_b');
insert into match_participants (match_id, player_id, side) values
 ('ffffffff-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','A'),('ffffffff-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','A'),
 ('ffffffff-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000003','B'),('ffffffff-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000004','B'),
 ('ffffffff-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','A'),('ffffffff-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000005','A'),
 ('ffffffff-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','B'),('ffffffff-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','B');
insert into round_rests (round_id, player_id) values ('eeeeeeee-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000005'),('eeeeeeee-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000004');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) is not null;
select case when string_agg(x->>'display_name'||':'||(x->>'matches_played')||'/'||(x->>'rests'), ' ' order by x->>'display_name') = 'P1:2/0 P2:2/0 P3:2/0 P4:1/1 P5:1/1'
  then 'PASS  played/rests counted from the night' else 'FAIL  '||string_agg(x->>'display_name'||':'||(x->>'matches_played')||'/'||(x->>'rests'), ' ') end
  from jsonb_array_elements(admin_session_detail('bbbbbbbb-0000-0000-0000-000000000001')->'players') x;
select case when admin_session_detail('bbbbbbbb-0000-0000-0000-000000000001') ? 'ratings' then 'PASS  every other key still there' else 'FAIL keys' end;
