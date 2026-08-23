-- ---------------------------------------------------------------------
-- 0049 — two bugs, and a club's own history.
--
-- 1. A CLAIMED SESSION NEVER APPEARED IN THAT PLAYER'S OWN TAB.
--    get_player_sessions has matched on a confirmed join request BY EMAIL
--    since 0006. Claiming a spot doesn't file a join request — that's the
--    whole point of claiming, you're taking a seat the host already typed in —
--    so the session vanished from the one list where the player would look for
--    it. Their record, rating and partner stats all included it, because
--    get_my_participation matches on players.linked_user_id. The profile could
--    therefore say "12 sessions played" directly above a list of eleven.
--
--    The fix is the union: a session is yours if you were confirmed by email
--    OR if a player row in it is linked to your account. Same for a spot an
--    admin links after the fact.
--
-- 2. THE ADMIN "CREDIT RATING" BUTTON WAS OFFERED WHERE IT CANNOT WORK.
--    /admin/s/<id> showed it for every linked player on an ended, rated
--    session — which is nearly everyone, since ending a session rates them all.
--    admin_credit_session_rating refuses correctly (a rating_history row for
--    that pair already exists), so nothing was ever double-counted; the button
--    was simply wrong 95% of the time and only proved it after a tap. The
--    guard was in the database doing the thinking the interface should have
--    done. admin_session_detail now says, per player, whether this session has
--    already counted toward their rating.
--
-- 3. A CLUB'S PAST SESSIONS.
--    get_club_sessions gains the winner and the field size so the club page can
--    list its own history without a second round trip. Returns-table shape
--    changes need a drop first (42P13).
-- ---------------------------------------------------------------------

-- --- 1. Claimed sessions belong to the claimer -------------------------
create or replace function get_player_sessions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
  from (
    -- Confirmed by email: the original route, for someone the host invited.
    select distinct s.id, s.name, s.format, s.status, s.created_at, s.public_token
      from join_requests jr
      join sessions s on s.id = jr.session_id
     where jr.status = 'confirmed'
       and lower(jr.email) = lower(nullif(auth.jwt() ->> 'email', ''))

    union

    -- Claimed, or linked afterwards by an admin: a player row that IS you.
    select distinct s.id, s.name, s.format, s.status, s.created_at, s.public_token
      from players p
      join sessions s on s.id = p.session_id
     where p.linked_user_id = auth.uid()
       and s.status <> 'draft'
  ) t;
$$;

grant execute on function get_player_sessions() to authenticated;

comment on function get_player_sessions() is
  'Sessions the caller played: confirmed by email OR holding a player row linked to their account (a claimed spot files no join request, which is why the second branch exists).';

-- --- 2. Does this session already count toward that account's rating? ---
create or replace function admin_session_detail(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_payload jsonb;
begin
  perform admin_guard();

  select jsonb_build_object(
    'session', (
      select to_jsonb(x) from (
        select s.id, s.name, s.format, s.scoring_format, s.ranking_basis, s.status,
               s.join_code, s.public_token, s.fixed_partner_style, s.team_score_mode,
               s.counts_for_league, coalesce(s.ratings_applied, false) as ratings_applied,
               exists (select 1 from session_results sr where sr.session_id = s.id) as results_applied,
               s.created_at, s.started_at, s.ended_at, s.created_by,
               hp.display_name as host_name, hu.email as host_email,
               s.club_id, c.name as club_name
          from sessions s
          left join profiles hp on hp.id = s.created_by
          left join auth.users hu on hu.id = s.created_by
          left join clubs c on c.id = s.club_id
         where s.id = p_session_id
      ) x
    ),
    'players', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.display_name), '[]'::jsonb)
        from (
          select pl.id, pl.display_name, pl.gender, pl.team_side, pl.preferred_side,
                 pl.status, pl.matches_played, pl.rests, pl.email,
                 pl.linked_user_id, pr.display_name as account_name, au.email as account_email,
                 exists (
                   select 1 from join_requests jr
                    where jr.session_id = p_session_id
                      and jr.status = 'confirmed'
                      and au.email is not null
                      and lower(jr.email) = lower(au.email)
                 ) as has_join_request,
                 -- The flag the Credit rating button should have been reading
                 -- all along: a rating_history row for (this account, this
                 -- session) means the night already moved their number.
                 exists (
                   select 1 from rating_history rh
                    where rh.session_id = p_session_id
                      and rh.user_id = pl.linked_user_id
                 ) as rated_for_session
            from players pl
            left join profiles pr on pr.id = pl.linked_user_id
            left join auth.users au on au.id = pl.linked_user_id
           where pl.session_id = p_session_id
        ) p
    ),
    'rounds', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.sequence), '[]'::jsonb)
        from (
          select rd.id, rd.sequence, rd.status, rd.generation_reason, rd.generated_at,
                 (select coalesce(jsonb_agg(to_jsonb(m) order by m.court_ordinal), '[]'::jsonb)
                    from (
                      select mt.id, ct.display_name as court_label, ct.ordinal as court_ordinal,
                             mt.score_a, mt.score_b, mt.outcome, mt.status,
                             (select string_agg(pl.display_name, ' & ' order by pl.display_name)
                                from match_participants mp join players pl on pl.id = mp.player_id
                               where mp.match_id = mt.id and mp.side = 'A') as team_a,
                             (select string_agg(pl.display_name, ' & ' order by pl.display_name)
                                from match_participants mp join players pl on pl.id = mp.player_id
                               where mp.match_id = mt.id and mp.side = 'B') as team_b
                        from matches mt
                        left join courts ct on ct.id = mt.court_id
                       where mt.round_id = rd.id
                    ) m
                 ) as matches
            from rounds rd
           where rd.session_id = p_session_id
        ) r
    )
  ) into v_payload;

  return v_payload;
end;
$$;

revoke all on function admin_session_detail(uuid) from anon;
grant execute on function admin_session_detail(uuid) to authenticated;

-- --- 3. A club's sessions, with who won ---------------------------------
drop function if exists get_club_sessions(uuid);

create or replace function get_club_sessions(p_club_id uuid)
returns table (
  id uuid, name text, status text, format text,
  created_at timestamptz, started_at timestamptz, ended_at timestamptz,
  public_token text, created_by uuid, counts_for_league boolean,
  winner_name text, field_size int
) language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.status, s.format, s.created_at, s.started_at, s.ended_at,
         s.public_token, s.created_by, coalesce(s.counts_for_league, true),
         w.display_name as winner_name,
         (select count(*)::int from session_results sr where sr.session_id = s.id) as field_size
  from sessions s
  left join lateral (
    select pr.display_name
      from session_results sr
      join profiles pr on pr.id = sr.user_id
     where sr.session_id = s.id and sr.rank = 1
     limit 1
  ) w on true
  where s.club_id = p_club_id and s.status <> 'draft' and is_club_member(p_club_id)
  order by s.created_at desc;
$$;

grant execute on function get_club_sessions(uuid) to authenticated;

comment on function get_club_sessions(uuid) is
  'Every non-draft session a club has played, newest first, with the winner where results were recorded. Members only.';
