-- ---------------------------------------------------------------------
-- 0031_side_americano.sql  (Fixed-Position Americano)
--
-- A new play format: Americano where every team is one LEFT-side player and one
-- RIGHT-side player (partners still rotate each round, like Americano — but the
-- pairing is always left+right). It reuses the Mix Americano engine keyed on the
-- player's preferred_side (L/R) instead of gender. Only a new format value is
-- needed here — the side is already stored on players.preferred_side (0005).
-- ---------------------------------------------------------------------

alter table sessions drop constraint if exists sessions_format_check;
alter table sessions add constraint sessions_format_check
  check (format in (
    'americano', 'mexicano', 'mix_americano', 'mix_mexicano',
    'fixed_partner', 'team_sparring', 'side_americano'
  ));
