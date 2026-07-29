-- =====================================================================
-- Team Sparring: multiple team-score display options.
--
-- The host asked for the running "Team A vs Team B" score to be computable
-- a few different ways depending on how their group actually plays:
--   by_point — sum of every player's own scored points/games on each side
--              (the original/default behavior — same numbers the
--              individual Standings tab is built from). Shown as raw
--              point totals, e.g. "88 - 60".
--   by_win   — +1 to a side's tally each time a match (one court, one
--              round) is won by that side. Simple running court-win count,
--              e.g. "5 - 3".
--   by_round — +1 to a side's tally only when that side wins the MAJORITY
--              of courts within a round (e.g. 2 of 3 courts), e.g. "1 - 1"
--              after 2 rounds split one apiece. Requires an ODD court
--              count so every round has a decisive majority winner — the
--              app blocks selecting this mode for an even court count
--              (see CreateSessionPage.tsx) rather than trying to define a
--              tie rule for a split round.
--
-- Nullable and only meaningful for format = 'team_sparring' — every other
-- format leaves it null and ignores it.
-- =====================================================================

alter table sessions
  add column team_score_mode text
    check (team_score_mode in ('by_point', 'by_win', 'by_round'));
