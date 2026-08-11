-- ---------------------------------------------------------------------
-- 0034_scaling_indexes.sql  (capacity: profile lookups + notification growth)
--
-- Two sequential scans and one unbounded table, fixed while everything is still
-- small enough that this migration runs instantly.
--
-- 1. players.linked_user_id had no index, so get_public_profile (0027) — which
--    is PUBLIC and anon-callable — scanned every player row ever created to
--    find one person's sessions.
--
-- 2. match_participants' primary key is (match_id, player_id). That serves
--    "who played this match" but NOT "which matches did this player play",
--    because player_id is the trailing column. The profile's record / form /
--    rating history all ask the second question, so they scanned the largest
--    table in the database (4 rows per match, forever).
--
-- 3. notifications had no retention at all. Every session start notifies every
--    club member, so the table only ever grew.
-- ---------------------------------------------------------------------

-- 1. Partial: the overwhelming majority of players are guests with a null link,
--    and `linked_user_id = X` implies `is not null`, so the planner still uses
--    it while the index stays a fraction of the table's size.
create index if not exists players_linked_user_idx
  on players (linked_user_id)
  where linked_user_id is not null;

-- 2. The reverse direction of the (match_id, player_id) primary key.
create index if not exists match_participants_player_idx
  on match_participants (player_id);

-- 3. Session results are already indexed by user; matches are looked up by
--    round + status together on every standings rebuild, so pay for the pair.
create index if not exists matches_round_status_idx
  on matches (round_id, status);

-- ---------------------------------------------------------------------
-- Notification retention
--
-- Prunes the CALLER's own notifications only: read ones past `p_days`, plus
-- anything beyond the newest `p_keep` regardless of age (so a very active user
-- can't accumulate indefinitely either). Called opportunistically when the
-- notifications screen opens — the same housekeeping pattern sweepStaleDrafts
-- already uses, and it needs no extensions or dashboard configuration.
--
-- If you'd rather prune globally on a schedule, enable the pg_cron extension and
-- schedule a nightly job whose command deletes read notifications older than 60
-- days. That covers dormant accounts too, which the client-side call can't.
-- ---------------------------------------------------------------------
create or replace function prune_notifications(p_days int default 60, p_keep int default 200)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_uid is null then return 0; end if;

  with removed as (
    delete from notifications
     where user_id = v_uid
       and (
         (read and created_at < now() - make_interval(days => greatest(p_days, 1)))
         or id in (
           select id from notifications
            where user_id = v_uid
            order by created_at desc
            offset greatest(p_keep, 50)
         )
       )
    returning 1
  )
  select count(*) into v_deleted from removed;

  return v_deleted;
end;
$$;

grant execute on function prune_notifications(int, int) to authenticated;
