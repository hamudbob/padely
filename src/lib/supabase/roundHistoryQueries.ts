import { supabase } from "./client";

export interface RoundHistoryMatch {
  id: string;
  courtName: string;
  teamANames: string[];
  teamBNames: string[];
  /** Real player ids alongside the display names above — the Players tab
   * uses these to count matches played per player without risking a
   * same-name collision; never shown directly. */
  teamAIds: string[];
  teamBIds: string[];
  scoreA: number | null;
  scoreB: number | null;
  status: string;
  /** 'win_a' | 'win_b' | 'draw' | 'cancelled' | null — Team Sparring's by_win/by_round scoring reads this directly rather than re-deriving a winner from scoreA/scoreB. */
  outcome: string | null;
}

export interface RoundHistoryEntry {
  roundId: string;
  sequence: number;
  status: string;
  matches: RoundHistoryMatch[];
  restingNames: string[];
  /** Player ids resting this round, alongside restingNames above. */
  restingIds: string[];
}

/**
 * Every round in the session (correction #6: "add a button to see previous
 * rounds"), most recent first, each with its own matches/scores/resters —
 * read-only, no score-entry here (that stays on the "This Round" tab, which
 * only ever touches the latest round). Fires after every score save, so its
 * round-trip count matters: courts/players/rounds are all independent of
 * each other, and matches/rests only depend on roundIds (not on each
 * other) — both stages run as a single parallel batch instead of five
 * sequential round trips. Only participants (needs matchIds) stays after.
 */
export async function getRoundHistory(sessionId: string): Promise<RoundHistoryEntry[]> {
  const [
    { data: courts, error: courtsError },
    { data: players, error: playersError },
    { data: rounds, error: roundsError },
  ] = await Promise.all([
    supabase.from("courts").select("id, display_name").eq("session_id", sessionId),
    supabase.from("players").select("id, display_name").eq("session_id", sessionId),
    supabase.from("rounds").select("id, sequence, status").eq("session_id", sessionId).order("sequence", { ascending: false }),
  ]);
  if (courtsError) throw courtsError;
  if (playersError) throw playersError;
  if (roundsError) throw roundsError;

  const courtNameById = new Map((courts ?? []).map((c) => [c.id, c.display_name]));
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.display_name]));
  const roundList = rounds ?? [];
  const roundIds = roundList.map((r) => r.id);

  const [
    { data: matchRows, error: matchesError },
    { data: rests, error: restsError },
  ] =
    roundIds.length > 0
      ? await Promise.all([
          supabase
            .from("matches")
            .select("id, round_id, court_id, score_a, score_b, status, outcome")
            .in("round_id", roundIds),
          supabase.from("round_rests").select("round_id, player_id").in("round_id", roundIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
  if (matchesError) throw matchesError;
  if (restsError) throw restsError;
  const matches = matchRows ?? [];

  const matchIds = matches.map((m) => m.id);
  const { data: participants, error: participantsError } =
    matchIds.length > 0
      ? await supabase.from("match_participants").select("match_id, player_id, side").in("match_id", matchIds)
      : { data: [], error: null };
  if (participantsError) throw participantsError;
  const participantsByMatch = new Map<string, { player_id: string; side: "A" | "B" }[]>();
  for (const p of participants ?? []) {
    const list = participantsByMatch.get(p.match_id) ?? [];
    list.push({ player_id: p.player_id, side: p.side });
    participantsByMatch.set(p.match_id, list);
  }

  return roundList.map((round) => {
    const roundMatches = matches
      .filter((m) => m.round_id === round.id)
      .map((m) => {
        const parts = participantsByMatch.get(m.id) ?? [];
        const teamA = parts.filter((p) => p.side === "A");
        const teamB = parts.filter((p) => p.side === "B");
        return {
          id: m.id,
          courtName: courtNameById.get(m.court_id) ?? "Court",
          teamANames: teamA.map((p) => playerNameById.get(p.player_id) ?? "?"),
          teamBNames: teamB.map((p) => playerNameById.get(p.player_id) ?? "?"),
          teamAIds: teamA.map((p) => p.player_id),
          teamBIds: teamB.map((p) => p.player_id),
          scoreA: m.score_a,
          scoreB: m.score_b,
          status: m.status,
          outcome: m.outcome,
        };
      });
    const restingForRound = (rests ?? []).filter((r) => r.round_id === round.id);
    const restingIds = restingForRound.map((r) => r.player_id);
    const restingNames = restingIds.map((id) => playerNameById.get(id) ?? "?");

    return {
      roundId: round.id,
      sequence: round.sequence,
      status: round.status,
      matches: roundMatches,
      restingNames,
      restingIds,
    };
  });
}
