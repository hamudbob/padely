-- ---------------------------------------------------------------------
-- 0050  Put back the half of admin_session_detail that 0049 dropped
--
-- 0049 added one field to admin_session_detail (rated_for_session) by
-- rewriting the whole function from memory, and the rewrite only carried
-- three of the eight keys 0043 returned. The admin session page reads
-- data.ratings.length with no guard, so the first admin who opened a
-- session after 0049 got an error screen instead of a page.
--
-- This restores score_edits, ratings, league_rows, join_requests and
-- claims exactly as 0043 defined them, keeps rated_for_session, and puts
-- results_applied back on the sessions column rather than the exists()
-- probe 0049 substituted for it (they disagree for a session whose
-- results were written and later cleared).
--
-- 0049 has been corrected in place too, so a fresh replay is right; this
-- file is for databases where 0049 already ran.
-- ---------------------------------------------------------------------

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
               coalesce(s.results_applied, false) as results_applied,
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
    ),

    -- Everything below this line existed in 0043 and must keep existing: the
    -- admin session page reads every one of these keys unguarded, so dropping
    -- one is not a smaller payload, it is a white screen.
    'score_edits', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.edited_at desc), '[]'::jsonb)
        from (
          select se.id, se.old_score_a, se.old_score_b, se.new_score_a, se.new_score_b,
                 se.reason, se.edited_at, pr.display_name as edited_by
            from score_edits se
            join matches mt on mt.id = se.match_id
            join rounds rd on rd.id = mt.round_id
            left join profiles pr on pr.id = se.edited_by
           where rd.session_id = p_session_id
           order by se.edited_at desc limit 50
        ) e
    ),

    -- What the session actually wrote when it ended. Empty here with an
    -- ended status is the silent-failure signature.
    'ratings', (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.delta desc), '[]'::jsonb)
        from (
          select rh.user_id, pr.display_name, rh.rating, rh.delta,
                 rh.rating_before, rh.games_before, rh.games_after, rh.created_at
            from rating_history rh
            left join profiles pr on pr.id = rh.user_id
           where rh.session_id = p_session_id
        ) h
    ),

    'league_rows', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.rank), '[]'::jsonb)
        from (
          select sr.user_id, pr.display_name, sr.rank, sr.placement_points, sr.podium_bonus,
                 sr.wins, sr.losses, sr.draws, sr.perf_adj
            from session_results sr
            left join profiles pr on pr.id = sr.user_id
           where sr.session_id = p_session_id
        ) l
    ),

    'join_requests', (
      select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at), '[]'::jsonb)
        from (
          select jr.id, jr.display_name, jr.email, jr.status, jr.player_id,
                 jr.created_at, jr.decided_at
            from join_requests jr where jr.session_id = p_session_id
        ) j
    ),

    'claims', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
        from (
          select pc.id, pc.player_id, pc.claimant_user_id, pr.display_name as claimant,
                 pc.status, pc.created_at, pc.decided_at
            from player_claims pc
            left join profiles pr on pr.id = pc.claimant_user_id
           where pc.session_id = p_session_id
        ) c
    )
  ) into v_payload;

  return v_payload;
end;
$$;

revoke all on function admin_session_detail(uuid) from anon;
grant execute on function admin_session_detail(uuid) to authenticated;
