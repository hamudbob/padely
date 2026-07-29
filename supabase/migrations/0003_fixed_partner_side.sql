-- =====================================================================
-- Fixed Partner: optional "preferred side" per player (left/revés or
-- right/drive — the standard padel doubles convention).
--
-- The `pairs` table, `matches.pair_a_id`/`pair_b_id`, and the
-- `standings_live_pairs` view this format needs already exist in
-- 0001_init.sql (see its "PAIRS" section and comment #4) — they were
-- scaffolded for Fixed Partner from day one and just needed the engine +
-- UI wired up, no new migration for those.
--
-- The one genuinely new piece of data is this column: the host's "auto-pair
-- by position" option needs to know which side each player prefers before
-- it can pair one left with one right. Nullable and only ever read at
-- pairing time (session creation) for Fixed Partner — every other format,
-- and Fixed Partner's other two pairing modes (manual / auto-random),
-- ignore it entirely.
-- =====================================================================

alter table players
  add column preferred_side text
    check (preferred_side in ('left', 'right'));
