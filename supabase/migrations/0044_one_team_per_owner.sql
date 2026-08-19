-- ---------------------------------------------------------------------
-- 0044_one_team_per_owner.sql
--
-- One account had a permanently broken home screen: "Could not load your
-- sessions." on every device, surviving sign-out, account deletion and
-- re-registration. Auth was healthy — confirmed, unbanned, signing in fine.
--
-- THE CAUSE. getHostHomeSummary asks for the caller's team with
--
--     .from("teams").select("id").eq("owner_id", user.id).maybeSingle()
--
-- and maybeSingle() is an ERROR when more than one row comes back. That
-- account had two teams rows, so its very first query failed and the whole
-- home screen fell over — for that account only, on every device, forever,
-- because the duplicate lives in the database.
--
-- HOW A SECOND ROW HAPPENS. ensureHostTeam is a check-then-insert:
--
--     select id from teams where owner_id = $1 limit 1
--     -- if nothing came back:
--     insert into teams (owner_id, name) values ($1, ...)
--
-- with nothing unique about owner_id to stop it. Two of those interleaved —
-- sign-in and onboarding firing together, two tabs, a double-tapped button,
-- a retried request — and both see "no team" and both insert. There is no
-- error at the time. The damage only shows up later, on a screen that
-- assumed one row.
--
-- Worth saying plainly: the read was as much at fault as the write.
-- maybeSingle() on a column with no unique constraint is a promise the schema
-- was never asked to keep.
--
-- THIS MIGRATION does three things, in this order:
--
--   1. repoints every session to the surviving team FIRST. sessions.team_id
--      is ON DELETE CASCADE, so deleting a duplicate team before repointing
--      would silently delete that team's sessions — the players, rounds,
--      matches and scores with them. The keeper is whichever row holds the
--      most sessions (oldest wins a tie), so the fewest rows have to move.
--   2. deletes the now-childless duplicates.
--   3. adds the unique index that makes the race impossible from here on.
--      With it in place the losing insert fails with 23505 instead of
--      succeeding, and the client (auth.ts) now treats that as "someone else
--      created it first" — which is exactly what it means.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

do $$
declare
  v_dupes   integer;
  v_moved   integer;
  v_deleted integer;
begin
  select count(*) into v_dupes
    from (select owner_id from teams group by owner_id having count(*) > 1) d;

  if v_dupes = 0 then
    raise notice 'No owner has more than one team — nothing to repair.';
  else
    raise notice '% owner(s) with duplicate teams; repairing.', v_dupes;

    create temporary table team_dedupe on commit drop as
    select t.id,
           t.owner_id,
           row_number() over w  as rn,
           first_value(t.id) over w as keeper
      from teams t
    window w as (
      partition by t.owner_id
      order by (select count(*) from sessions s where s.team_id = t.id) desc,
               t.created_at asc,
               t.id asc
    );

    -- 1. Move the sessions off the rows that are about to go. Must happen
    --    before the delete: the FK cascades.
    update sessions s
       set team_id = d.keeper
      from team_dedupe d
     where s.team_id = d.id
       and d.rn > 1;
    get diagnostics v_moved = row_count;

    -- 2. Now the duplicates own nothing and can go.
    delete from teams t
     using team_dedupe d
     where t.id = d.id
       and d.rn > 1;
    get diagnostics v_deleted = row_count;

    raise notice 'Moved % session(s), removed % duplicate team row(s).', v_moved, v_deleted;
  end if;
end;
$$;

-- 3. The constraint that stops it recurring. Created after the repair, so it
--    cannot fail on data that already violates it.
create unique index if not exists teams_owner_id_key on teams (owner_id);

comment on index teams_owner_id_key is
  'One team per account. Without this, ensureHostTeam''s check-then-insert could run twice concurrently and leave two rows, which broke getHostHomeSummary''s maybeSingle() and with it the whole home screen — permanently, for that account, on every device.';
