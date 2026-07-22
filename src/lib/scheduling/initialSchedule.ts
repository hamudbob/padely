import { generateAmericanoSchedule } from "./americano";
import { generateMexicanoRound, StandingLookup } from "./mexicano";
import { generateTeamSparringSchedule } from "./teamSparring";
import { generateMixAmericanoSchedule, Gender } from "./mixAmericano";
import { generateMixMexicanoRound } from "./mixMexicano";
import { Pair, PairFairnessState, generateFixedPartnerSchedule, generateFixedPartnerRankedRound } from "./fixedPartner";
import { mulberry32, PlayerFairnessState, PlayerId, RoundResult } from "./types";

export type ScheduleFormat = "americano" | "mexicano" | "mix_americano" | "mix_mexicano" | "team_sparring" | "fixed_partner";

export interface SchedulePlayer {
  id: string;
  gender: Gender;
  teamSide: "A" | "B" | null;
}

export interface InitialScheduleInput {
  players: SchedulePlayer[];
  courtsAvailable: number;
  format: ScheduleFormat;
  schedulingSeed: number;
  roundCount: number;
  /** Non-null only for locked-partner sessions. */
  fixedPartnerStyle?: "round_robin" | "rank_based" | null;
  /** Fixed Partner only — the resolved pairs to schedule. */
  pairs?: Pair[];
}

/**
 * THE single source of truth for a session's initial round(s). Extracted
 * verbatim from the create wizard's preview so the wizard and the lobby's
 * "Start" produce identical draws from identical inputs — they can never
 * diverge, because there's only one copy of this logic.
 *
 * Player ids are opaque strings: the wizard passes its tempIds, the lobby
 * passes real DB player ids. The returned RoundResult[] carries those same ids
 * straight through, so each caller maps them back to whatever it needs.
 *
 * Score-based formats (Mexicano / Mix Mexicano / Fixed Partner rank_based)
 * return only Round 1 — later rounds are generated live once scores exist.
 * Score-independent formats (Americano / Team Sparring / Mix Americano / Fixed
 * Partner round_robin) return the whole schedule up front.
 */
export function generateInitialRounds(input: InitialScheduleInput): RoundResult[] {
  const { players, courtsAvailable, format, schedulingSeed, roundCount, fixedPartnerStyle, pairs } = input;
  if (players.length < 4) return [];
  const activePlayerIds: PlayerId[] = players.map((p) => p.id);
  const genderById = new Map<PlayerId, Gender>(players.map((p) => [p.id, p.gender]));
  const isFixedPartner = fixedPartnerStyle != null;

  if (isFixedPartner) {
    const resolvedPairs = pairs ?? [];
    if (resolvedPairs.length === 0) return [];
    if (fixedPartnerStyle === "round_robin") {
      return generateFixedPartnerSchedule({ pairs: resolvedPairs, courtsAvailable, roundCount, schedulingSeed });
    }
    // rank_based — round-by-round like Mexicano, so only Round 1 up front.
    const pairStats = new Map<string, PairFairnessState>(
      resolvedPairs.map((p) => [p.pairId, { pairId: p.pairId, matchesPlayed: 0, restedLastRound: false }]),
    );
    const rng = mulberry32(schedulingSeed + 1);
    const round1 = generateFixedPartnerRankedRound({
      pairs: resolvedPairs,
      statsById: pairStats,
      courtsAvailable,
      standings: { rankValue: () => 0 },
      isFirstRound: true,
      rng,
    });
    return round1.matches.length > 0 ? [round1] : [];
  }

  if (format === "mexicano" || format === "mix_mexicano") {
    const stats = new Map<string, PlayerFairnessState>(
      activePlayerIds.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const rng = mulberry32(schedulingSeed + 1);
    const standings: StandingLookup = { rankValue: () => 0 };
    const round1 =
      format === "mix_mexicano"
        ? generateMixMexicanoRound({
            activePlayerIds,
            genderById,
            statsById: stats,
            courtsAvailable,
            standings,
            isFirstRound: true,
            rng,
          })
        : generateMexicanoRound({
            activePlayerIds,
            statsById: stats,
            courtsAvailable,
            standings,
            isFirstRound: true,
            rng,
          });
    return round1.matches.length > 0 ? [round1] : [];
  }

  if (format === "team_sparring") {
    const teamA = players.filter((p) => p.teamSide === "A").map((p) => p.id);
    const teamB = players.filter((p) => p.teamSide === "B").map((p) => p.id);
    return generateTeamSparringSchedule({ roster: { teamA, teamB }, courtsAvailable, roundCount, schedulingSeed });
  }

  if (format === "mix_americano") {
    return generateMixAmericanoSchedule({ activePlayerIds, genderById, courtsAvailable, roundCount, schedulingSeed });
  }

  return generateAmericanoSchedule({ activePlayerIds, courtsAvailable, roundCount, schedulingSeed });
}
