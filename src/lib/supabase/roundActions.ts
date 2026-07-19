import { supabase } from "./client";
import { generateAmericanoRound } from "../scheduling/americano";
import { generateMexicanoRound } from "../scheduling/mexicano";
import { generateTeamSparringRound, TeamRoster } from "../scheduling/teamSparring";
import {
  generateFixedPartnerRound,
  generateFixedPartnerRankedRound,
  Pair,
  PairFairnessState,
  PairHistory,
  buildPairByPlayerId,
} from "../scheduling/fixedPartner";
import { generateMixAmericanoRound, Gender } from "../scheduling/mixAmericano";
import { generateMixMexicanoRound } from "../scheduling/mixMexicano";
import {
  emptyHistory,
  recordRoundInHistory,
  mulberry32,
  pairKey,
  MatchHistory,
  PlayerFairnessState,
  PlayerId,
  RoundResult,
} from "../scheduling/types";
import { computeStandings, CompletedMatchResult } from "../scoring/standings";

export interface GenerateNextRoundResult {
  roundId: string;
  sequence: number;
}

/**
 * Generates + persists the next round for a live session (correction #6:
 * "Next Round button" — this is what it calls). Wired for every format
 * CreateSessionPage's FORMAT_OPTIONS enables: Mexicano and Mix Mexicano call
 * this for every round (their pairing depends on live standings); Americano,
 * Team Sparring, Fixed Partner, and Mix Americano only fall back to it for
 * an "Add Another Round" past their upfront-generated schedule.
 *
 * Guardrails: refuses to run unless every match in the current round is
 * Final (the Host Live page also disables the button until then, this is
 * the server-side backstop), and refuses to persist a round with zero
 * playable courts rather than silently saving an empty one.
 */
export async function generateNextRound(sessionId: string): Promise<GenerateNextRoundResult> {
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, format, scoring_format, ranking_basis, scheduling_seed, status, fixed_partner_style")
    .eq("id", sessionId)
    .single();
  if (sessionError) throw sessionError;

  // "fixed_partner" is kept here only for backward compatibility with any
  // session created before the rework (it used to be its own format value);
  // every session created since locks partners via fixed_partner_style on
  // top of a normal format instead — see 0004_fixed_partner_style.sql.
  const knownFormats = ["americano", "mexicano", "team_sparring", "fixed_partner", "mix_americano", "mix_mexicano"];
  if (!knownFormats.includes(session.format)) {
    throw new Error("Next round generation for this format isn't built yet.");
  }
  const isFixedPartner = session.fixed_partner_style !== null;
  const needsPairs = isFixedPartner || session.format === "fixed_partner";

  // courts/players/rounds/pairs are all independent of each other (none
  // needs another's result) — one parallel batch instead of four sequential
  // round trips. This whole function fires every time "Next Round" is
  // tapped, so its round-trip count matters a lot for perceived lag. Pairs
  // is wrapped in a small async helper with an explicit return type so TS
  // checks it against that annotation directly, rather than reconciling two
  // differently-shaped inline expressions (a real query vs. a literal empty
  // fallback) inside the same Promise.all slot.
  async function fetchPairs(): Promise<{ data: { id: string; player_a_id: string; player_b_id: string }[]; error: unknown }> {
    if (!needsPairs) return { data: [], error: null };
    const { data, error } = await supabase.from("pairs").select("id, player_a_id, player_b_id").eq("session_id", sessionId);
    return { data: data ?? [], error };
  }

  const [courtsResult, playersResult, roundsResult, pairsResult] = await Promise.all([
    supabase.from("courts").select("id, ordinal, available").eq("session_id", sessionId).eq("available", true).order("ordinal", { ascending: true }),
    supabase.from("players").select("id, status, team_side, gender").eq("session_id", sessionId).eq("status", "active"),
    supabase.from("rounds").select("id, sequence, status").eq("session_id", sessionId).order("sequence", { ascending: true }),
    fetchPairs(),
  ]);
  if (courtsResult.error) throw courtsResult.error;
  if (playersResult.error) throw playersResult.error;
  if (roundsResult.error) throw roundsResult.error;
  if (pairsResult.error) throw pairsResult.error;

  const availableCourts = courtsResult.data ?? [];
  const playerRows = playersResult.data ?? [];
  const activePlayerIds: PlayerId[] = playerRows.map((p) => p.id);
  // Team Sparring only — the roster split needed to keep every match a
  // Team A pair vs a Team B pair, same as the upfront schedule generation.
  const teamRoster: TeamRoster = {
    teamA: playerRows.filter((p) => p.team_side === "A").map((p) => p.id),
    teamB: playerRows.filter((p) => p.team_side === "B").map((p) => p.id),
  };
  // Mix Americano / Mix Mexicano only — every other format ignores this.
  const genderById = new Map<PlayerId, Gender>(playerRows.map((p) => [p.id, p.gender as Gender]));

  // Fixed Partner only — pairs are formed once at session creation and
  // never re-formed here; pairId is the REAL pairs.id (not the tempId-space
  // key sessionActions.ts uses before persistence).
  const pairs: Pair[] = (pairsResult.data ?? []).map((p) => ({ pairId: p.id, playerA: p.player_a_id, playerB: p.player_b_id }));

  const rounds = roundsResult.data;
  if (!rounds || rounds.length === 0) throw new Error("This session has no rounds yet.");

  const latestRound = rounds[rounds.length - 1];
  const roundIds = rounds.map((r) => r.id);

  // matches and rests both only depend on roundIds (not on each other) —
  // fetch together.
  const [matchesResult, restsResult] = await Promise.all([
    supabase.from("matches").select("id, round_id, court_id, score_a, score_b, outcome, status, pair_a_id, pair_b_id").in("round_id", roundIds),
    supabase.from("round_rests").select("round_id, player_id").in("round_id", roundIds),
  ]);
  if (matchesResult.error) throw matchesResult.error;
  if (restsResult.error) throw restsResult.error;
  const matches = matchesResult.data ?? [];
  const allRests = restsResult.data;

  const latestMatches = matches.filter((m) => m.round_id === latestRound.id);
  if (latestMatches.length === 0 || latestMatches.some((m) => m.status !== "final")) {
    throw new Error("Finish scoring every match in this round before generating the next one.");
  }

  const allMatchIds = matches.map((m) => m.id);
  const { data: allParticipants, error: participantsError } =
    allMatchIds.length > 0
      ? await supabase.from("match_participants").select("match_id, player_id, side").in("match_id", allMatchIds)
      : { data: [], error: null };
  if (participantsError) throw participantsError;
  const participants = allParticipants ?? [];

  // --- Fairness stats: matchesPlayed = every match a player has been
  // assigned to across every past round (assignment counts, same definition
  // the scheduling engine itself uses — not "matches scored"). ---
  const matchesPlayedById = new Map<PlayerId, number>();
  for (const p of participants) {
    matchesPlayedById.set(p.player_id, (matchesPlayedById.get(p.player_id) ?? 0) + 1);
  }
  const restedLastRoundSet = new Set(
    (allRests ?? []).filter((r) => r.round_id === latestRound.id).map((r) => r.player_id),
  );
  const statsById = new Map<PlayerId, PlayerFairnessState>();
  for (const id of activePlayerIds) {
    statsById.set(id, {
      playerId: id,
      matchesPlayed: matchesPlayedById.get(id) ?? 0,
      restedLastRound: restedLastRoundSet.has(id),
    });
  }

  // --- Match history (partner/opponent repeats) across every past round —
  // Americano's local search uses this; Mexicano ignores it but it's cheap
  // to build once for both. ---
  const participantsByMatch = new Map<string, { player_id: string; side: "A" | "B" }[]>();
  for (const p of participants) {
    const list = participantsByMatch.get(p.match_id) ?? [];
    list.push({ player_id: p.player_id, side: p.side });
    participantsByMatch.set(p.match_id, list);
  }
  const matchesByRound = new Map<string, typeof matches>();
  for (const m of matches) {
    const list = matchesByRound.get(m.round_id) ?? [];
    list.push(m);
    matchesByRound.set(m.round_id, list);
  }
  const history: MatchHistory = emptyHistory();
  for (const round of rounds) {
    const roundMatches = matchesByRound.get(round.id) ?? [];
    const roundResult: RoundResult = {
      courtsUsed: roundMatches.length,
      restingIds: [],
      explanation: "",
      matches: roundMatches.map((m, i) => {
        const parts = participantsByMatch.get(m.id) ?? [];
        const teamA = parts.filter((p) => p.side === "A").map((p) => p.player_id);
        const teamB = parts.filter((p) => p.side === "B").map((p) => p.player_id);
        return {
          courtIndex: i,
          teamA: [teamA[0], teamA[1]] as [string, string],
          teamB: [teamB[0], teamB[1]] as [string, string],
        };
      }),
    };
    recordRoundInHistory(history, roundResult);
  }

  // --- Fixed Partner only: pair-level fairness/history, derived straight
  // from matches.pair_a_id/pair_b_id (no round_rests-style table needed —
  // a resting pair simply has no match row that round, so "did this pair
  // play in the latest round" is enough to know restedLastRound). ---
  const pairHistory: PairHistory = { opponentPairsSeen: new Set() };
  const pairStatsById = new Map<string, PairFairnessState>();
  if (needsPairs) {
    const matchesPlayedByPairId = new Map<string, number>();
    const pairIdsInLatestRound = new Set<string>();
    for (const m of matches) {
      if (m.pair_a_id) matchesPlayedByPairId.set(m.pair_a_id, (matchesPlayedByPairId.get(m.pair_a_id) ?? 0) + 1);
      if (m.pair_b_id) matchesPlayedByPairId.set(m.pair_b_id, (matchesPlayedByPairId.get(m.pair_b_id) ?? 0) + 1);
      if (m.round_id === latestRound.id) {
        if (m.pair_a_id) pairIdsInLatestRound.add(m.pair_a_id);
        if (m.pair_b_id) pairIdsInLatestRound.add(m.pair_b_id);
      }
      if (m.pair_a_id && m.pair_b_id) pairHistory.opponentPairsSeen.add(pairKey(m.pair_a_id, m.pair_b_id));
    }
    for (const p of pairs) {
      pairStatsById.set(p.pairId, {
        pairId: p.pairId,
        matchesPlayed: matchesPlayedByPairId.get(p.pairId) ?? 0,
        restedLastRound: !pairIdsInLatestRound.has(p.pairId),
      });
    }
  }

  // --- Standings (Mexicano pairing only) — same computeStandings the
  // Standings tab will use, so pairing decisions and displayed rank can
  // never drift apart. ---
  const finalMatches: CompletedMatchResult[] = matches
    .filter((m) => m.status === "final" && m.outcome && m.outcome !== "cancelled")
    .map((m) => {
      const parts = participantsByMatch.get(m.id) ?? [];
      return {
        matchId: m.id,
        sideA: parts.filter((p) => p.side === "A").map((p) => p.player_id),
        sideB: parts.filter((p) => p.side === "B").map((p) => p.player_id),
        scoreA: m.score_a ?? 0,
        scoreB: m.score_b ?? 0,
        outcome: m.outcome as "win_a" | "win_b" | "draw",
      };
    });
  const standingsRows = computeStandings(activePlayerIds, finalMatches, [], session.ranking_basis);
  const rankValueById = new Map<PlayerId, number>(
    standingsRows.map((r) => [r.subjectId, session.ranking_basis === "points_first" ? r.totalPoints : r.wins]),
  );

  const newSequence = latestRound.sequence + 1;
  const roundSeed = session.scheduling_seed + newSequence;
  const rng = mulberry32(roundSeed);

  const standingsLookup = { rankValue: (id: PlayerId) => rankValueById.get(id) ?? 0 };
  // Fixed Partner rank-based only — a pair's rank is just either partner's
  // own individual rankValue, since fixed partners always share identical
  // stats (they never play apart, so match_participants credits them
  // identically every round). No separate pair-standings computation needed.
  const pairByIdForRanking = new Map(pairs.map((p) => [p.pairId, p.playerA]));
  const pairStandingsLookup = { rankValue: (pairId: string) => rankValueById.get(pairByIdForRanking.get(pairId) ?? "") ?? 0 };

  const result: RoundResult =
    // Locked-partner sessions branch on fixed_partner_style FIRST — it's a
    // modifier on top of whichever format was picked, not a format of its
    // own, so it takes priority over the normal per-format dispatch below.
    session.fixed_partner_style === "round_robin"
      ? generateFixedPartnerRound({
          pairs,
          statsById: pairStatsById,
          courtsAvailable: availableCourts.length,
          history: pairHistory,
          rng,
        })
      : session.fixed_partner_style === "rank_based"
        ? generateFixedPartnerRankedRound({
            pairs,
            statsById: pairStatsById,
            courtsAvailable: availableCourts.length,
            standings: pairStandingsLookup,
            isFirstRound: false, // round 1 is always handled by CreateSessionPage's preview + sessionActions.ts
            rng,
          })
        : // Legacy 'fixed_partner' format rows from before the rework — treat
          // as round-robin, matching the original (only) behavior that format ever had.
          session.format === "fixed_partner"
          ? generateFixedPartnerRound({
              pairs,
              statsById: pairStatsById,
              courtsAvailable: availableCourts.length,
              history: pairHistory,
              rng,
            })
          : session.format === "americano"
            ? generateAmericanoRound({ activePlayerIds, statsById, courtsAvailable: availableCourts.length, history, rng })
            : session.format === "team_sparring"
              ? generateTeamSparringRound({
                  roster: teamRoster,
                  statsById,
                  courtsAvailable: availableCourts.length,
                  history,
                  rng,
                })
              : session.format === "mix_americano"
                ? generateMixAmericanoRound({
                    activePlayerIds,
                    genderById,
                    statsById,
                    courtsAvailable: availableCourts.length,
                    history,
                    rng,
                  })
                : session.format === "mix_mexicano"
                  ? generateMixMexicanoRound({
                      activePlayerIds,
                      genderById,
                      statsById,
                      courtsAvailable: availableCourts.length,
                      standings: standingsLookup,
                      isFirstRound: false,
                      rng,
                    })
                  : generateMexicanoRound({
                      activePlayerIds,
                      statsById,
                      courtsAvailable: availableCourts.length,
                      standings: standingsLookup,
                      isFirstRound: false,
                      rng,
                    });

  if (result.courtsUsed === 0) {
    throw new Error(result.explanation);
  }

  // Mark the round that was just completed as scored, and persist the new
  // one, in parallel — neither write depends on the other's result (the new
  // round doesn't reference the old round's status).
  const [{ error: markScoredError }, { data: newRoundRow, error: newRoundError }] = await Promise.all([
    supabase.from("rounds").update({ status: "scored" }).eq("id", latestRound.id),
    supabase
      .from("rounds")
      .insert({
        session_id: sessionId,
        sequence: newSequence,
        status: "in_progress",
        generation_reason: `Round ${newSequence} generated automatically after Round ${latestRound.sequence} was fully scored.`,
        seed_used: roundSeed,
      })
      .select("id")
      .single(),
  ]);
  if (markScoredError) throw markScoredError;
  if (newRoundError) throw newRoundError;

  // Fixed Partner only — pairId here is already the real pairs.id (see the
  // reconstruction above), so no tempId remapping is needed like
  // sessionActions.ts does at session creation.
  const pairByPlayerId = needsPairs ? buildPairByPlayerId(pairs) : new Map<string, string>();

  // Bulk-insert every match for this round in ONE round trip (instead of
  // looping match-by-match, each doing its own insert), and the resting-
  // players insert alongside it — round_rests only needs newRoundRow.id, not
  // anything from the matches insert, so the two run in parallel. court_id
  // is unique within a round, so it's a safe correlation key back to each
  // match's id without depending on the array coming back in insert order.
  const matchInserts = result.matches.map((match) => {
    const courtId = availableCourts[match.courtIndex].id;
    const pairAId = pairByPlayerId.get(match.teamA[0]);
    const pairBId = pairByPlayerId.get(match.teamB[0]);
    return {
      round_id: newRoundRow.id,
      court_id: courtId,
      status: "not_started" as const,
      ...(pairAId && pairBId ? { pair_a_id: pairAId, pair_b_id: pairBId } : {}),
    };
  });

  async function insertRests(): Promise<{ error: unknown }> {
    if (result.restingIds.length === 0) return { error: null };
    const { error } = await supabase.from("round_rests").insert(
      result.restingIds.map((playerId) => ({
        round_id: newRoundRow.id,
        player_id: playerId,
        consecutive_rest_count: 0,
      })),
    );
    return { error };
  }

  const [matchInsertResult, restsInsertResult] = await Promise.all([
    supabase.from("matches").insert(matchInserts).select("id, court_id"),
    insertRests(),
  ]);
  if (matchInsertResult.error) throw matchInsertResult.error;
  if (restsInsertResult.error) throw restsInsertResult.error;

  const matchIdByCourtId = new Map((matchInsertResult.data ?? []).map((m) => [m.court_id, m.id]));
  const allParticipantsInsert = result.matches.flatMap((match) => {
    const courtId = availableCourts[match.courtIndex].id;
    const matchId = matchIdByCourtId.get(courtId)!;
    return [
      ...match.teamA.map((playerId) => ({ match_id: matchId, player_id: playerId, side: "A" as const })),
      ...match.teamB.map((playerId) => ({ match_id: matchId, player_id: playerId, side: "B" as const })),
    ];
  });
  const { error: participantsInsertError } = await supabase.from("match_participants").insert(allParticipantsInsert);
  if (participantsInsertError) throw participantsInsertError;

  return { roundId: newRoundRow.id, sequence: newSequence };
}
