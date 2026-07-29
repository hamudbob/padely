-- =====================================================================
-- Fixed Partner, reworked: it's no longer its own `format` value. Locking
-- partners for the whole session is really a MODIFIER on top of Americano's
-- round-robin fairness or Mexicano's rank-based pairing, not a third
-- algorithm — so the host now picks it as a toggle on the Players step,
-- underneath whichever of Americano/Mexicano they already chose as the
-- base format (see CreateSessionPage.tsx).
--
-- `format` therefore only ever gets set to 'americano' | 'mexicano' |
-- 'mix_americano' | 'mix_mexicano' | 'team_sparring' going forward. The
-- 'fixed_partner' value is left in 0001_init.sql's check constraint
-- unchanged (harmless to leave an unused allowed value; that migration is
-- treated as immutable/historical) — the app just never writes it anymore.
--
-- This column carries which flavor is active when partners are locked:
--   round_robin — Americano-style. Opponent rotation avoids repeat pair-vs-
--                 pair matchups; the whole schedule generates upfront, same
--                 as plain Americano (see fixedPartner.ts's
--                 generateFixedPartnerSchedule).
--   rank_based  — Mexicano-style. Pairs are matched by current standing each
--                 round (rank1-pair vs rank2-pair, ...), generated
--                 round-by-round like Mexicano (see fixedPartner.ts's
--                 generateFixedPartnerRankedRound).
-- Null for every session where partners aren't locked at all.
-- =====================================================================

alter table sessions
  add column fixed_partner_style text
    check (fixed_partner_style in ('round_robin', 'rank_based'));
