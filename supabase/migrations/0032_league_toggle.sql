-- ---------------------------------------------------------------------
-- 0032_league_toggle.sql  (per-session "count for league")
--
-- Replaces the old "a session needs N+ players (session_floor) to count toward
-- the club league" rule with an explicit per-session choice the host makes in
-- the create wizard. Defaults TRUE, so every existing club session (and every
-- new one) counts unless the host turns it off. Non-club sessions carry the
-- flag too but never reach a league (the league only reads club sessions).
-- ---------------------------------------------------------------------

alter table sessions add column if not exists counts_for_league boolean not null default true;
