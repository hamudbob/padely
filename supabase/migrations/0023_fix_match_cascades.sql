-- ---------------------------------------------------------------------
-- 0023_fix_match_cascades.sql  (bugfix — deleting a session)
--
-- matches.court_id / pair_a_id / pair_b_id were created (0001) without an
-- ON DELETE rule, i.e. NO ACTION. So deleting a session — which cascades into
-- its courts and pairs — fails with:
--   update or delete on table "courts" violates foreign key constraint
--   "matches_court_id_fkey" on table "matches" (23503)
-- because the sibling `matches` rows still reference those courts/pairs at the
-- time the constraint is checked.
--
-- Fix: give these FKs a delete rule. court_id is NOT NULL, so it cascades
-- (deleting a court deletes its matches — which are being deleted with the
-- session anyway). pair_a_id/pair_b_id are nullable, so they SET NULL.
-- Idempotent: drop-if-exists then re-add. Safe to re-run.
-- ---------------------------------------------------------------------

alter table matches drop constraint if exists matches_court_id_fkey;
alter table matches
  add constraint matches_court_id_fkey
  foreign key (court_id) references courts(id) on delete cascade;

alter table matches drop constraint if exists matches_pair_a_id_fkey;
alter table matches
  add constraint matches_pair_a_id_fkey
  foreign key (pair_a_id) references pairs(id) on delete set null;

alter table matches drop constraint if exists matches_pair_b_id_fkey;
alter table matches
  add constraint matches_pair_b_id_fkey
  foreign key (pair_b_id) references pairs(id) on delete set null;
