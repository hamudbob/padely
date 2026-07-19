import { supabase } from "./client";
import type { Database } from "./database.types";
import type { RoundResult } from "../scheduling/types";
import { Pair, buildPairByPlayerId, pairLabel } from "../scheduling/fixedPartner";

type SessionFormat = Database["public"]["Tables"]["sessions"]["Row"]["format"];
type ScoringFormat = Database["public"]["Tables"]["sessions"]["Row"]["scoring_format"];
type RankingBasis = Database["public"]["Tables"]["sessions"]["Row"]["ranking_basis"];

export interface DraftPlayer {
  tempId: string;
  name: string;
  gender: "M" | "F";
  /** Team Sparring only — which fixed side this player is on for the whole session. */
  teamSide?: "A" | "B";
  /** Fixed Partner's "auto-pair by position" mode only. */
  preferredSide?: "left" | "right";
}

export interface DraftCourt {
  tempId: string;
  name: string;
}

export interface SessionDraft {
  name: string;
  format: SessionFormat;
  scoringFormat: ScoringFormat;
  rankingBasis: RankingBasis;
  players: DraftPlayer[];
  courts: DraftCourt[];
  /** Team Sparring only — 'by_point' | 'by_win' | 'by_round', how the Team A vs Team B banner tallies its score. */
  teamScoreMode?: "by_point" | "by_win" | "by_round";
  /** Fixed Partner only — the finalized pairing (tempId space) decided in the wizard,
   * whichever of manual/auto-random/auto-by-position the host used to get there. */
  pairs?: Pair[];
  /** Set only when the host locked partners for the session — 'round_robin'
   * (Americano base) or 'rank_based' (Mexicano base). Undefined otherwise. */
  fixedPartnerStyle?: "round_robin" | "rank_based";
}

function randomJoinCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** crypto.randomUUID() with dashes stripped — plenty of entropy, URL-friendly. */
function randomPublicToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export interface StartSessionResult {
  sessionId: string;
  joinCode: string;
  publicToken: string;
}

/**
 * Persists a fully-assembled draft + its already-computed round preview(s)
 * (see CreateSessionPage — the preview is computed once with temp ids, then
 * translated to real DB ids here, so what the host reviewed is exactly what
 * gets saved; the engine never runs a second time with a chance to diverge).
 *
 * `previewRounds` is a list because Americano generates its ENTIRE schedule
 * up front (no score dependency between rounds), while Mexicano still only
 * ever passes a single round (its pairing depends on standings, which don't
 * exist until a round is scored). The first round is always saved as
 * `'in_progress'`; any further pre-generated rounds are saved as `'planned'`
 * so the Host Live page knows they're not yet the "current" round.
 */
export async function createAndStartSession(
  draft: SessionDraft,
  previewRounds: RoundResult[],
  schedulingSeed: number,
): Promise<StartSessionResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  // RequireHost (see App.tsx) should stop anyone from reaching this page
  // without a session, but a token can still expire mid-wizard on a long
  // pause — give a clear, actionable message instead of Supabase's raw
  // "Auth session missing!" string.
  if (userError || !userData.user) {
    throw new Error("Your session expired while filling this out — please log in again (your draft won't be saved, sorry).");
  }
  const user = userData.user;

  const { data: teamRow, error: teamError } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .single();
  if (teamError) throw new Error("Could not find your team — try logging out and back in.");

  // join_code has a unique constraint; retry a few times on collision.
  let sessionId: string | null = null;
  let joinCode = "";
  let publicToken = "";
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5 && !sessionId; attempt++) {
    joinCode = randomJoinCode();
    publicToken = randomPublicToken();
    const { data: sessionRow, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        team_id: teamRow.id,
        name: draft.name,
        format: draft.format,
        scoring_format: draft.scoringFormat,
        ranking_basis: draft.rankingBasis,
        status: "live",
        join_code: joinCode,
        public_token: publicToken,
        scheduling_seed: schedulingSeed,
        min_players_per_court: 4,
        team_score_mode: draft.teamScoreMode ?? null,
        fixed_partner_style: draft.fixedPartnerStyle ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (sessionError) {
      lastError = sessionError;
      if (sessionError.code === "23505") continue; // unique violation on join_code -> retry
      throw sessionError;
    }
    sessionId = sessionRow.id;
  }
  if (!sessionId) throw lastError instanceof Error ? lastError : new Error("Could not create session (join code collision). Try again.");

  // courts and players are independent of each other (neither needs the
  // other's result) — one parallel batch instead of two sequential round
  // trips. Each insert stays in the same order as its draft array so we can
  // map tempId/courtIndex -> real id by position, same as before.
  const [
    { data: courtRows, error: courtsError },
    { data: playerRows, error: playersError },
  ] = await Promise.all([
    supabase
      .from("courts")
      .insert(draft.courts.map((c, i) => ({ session_id: sessionId!, ordinal: i + 1, display_name: c.name, available: true })))
      .select("id"),
    supabase
      .from("players")
      .insert(
        draft.players.map((p) => ({
          session_id: sessionId!,
          display_name: p.name,
          gender: p.gender,
          team_side: p.teamSide ?? null,
          preferred_side: p.preferredSide ?? null,
          status: "active" as const,
        })),
      )
      .select("id"),
  ]);
  if (courtsError) throw courtsError;
  if (playersError) throw playersError;
  const realCourtIds = courtRows.map((r) => r.id);

  const playerIdMap = new Map<string, string>();
  draft.players.forEach((p, i) => playerIdMap.set(p.tempId, playerRows[i].id));

  const pairByTempPlayerId = draft.pairs ? buildPairByPlayerId(draft.pairs) : new Map<string, string>();
  const nameByTempId = new Map(draft.players.map((p) => [p.tempId, p.name]));

  // Fixed Partner's pairs insert (needs playerIdMap, just built above) and
  // the WHOLE session's rounds insert (needs only sessionId) don't depend on
  // each other — fetch/insert together rather than one after the other.
  // sequence is selected back explicitly (not relied on via array order) so
  // the round-id lookup below is correct regardless of how Postgres returns
  // a bulk INSERT ... RETURNING. Each branch is wrapped in a small async
  // function with an explicit return type so TS checks it against that
  // annotation directly, rather than trying to reconcile two differently-
  // shaped inline expressions inside the same Promise.all slot.
  async function insertPairs(): Promise<{ data: { id: string }[]; error: unknown }> {
    if (!draft.pairs || draft.pairs.length === 0) return { data: [], error: null };
    const { data, error } = await supabase
      .from("pairs")
      .insert(
        draft.pairs.map((pair) => ({
          session_id: sessionId!,
          label: pairLabel(nameByTempId.get(pair.playerA) ?? "?", nameByTempId.get(pair.playerB) ?? "?"),
          is_auto_label: true,
          player_a_id: playerIdMap.get(pair.playerA)!,
          player_b_id: playerIdMap.get(pair.playerB)!,
        })),
      )
      .select("id");
    return { data: data ?? [], error };
  }

  async function insertRounds(): Promise<{ data: { id: string; sequence: number }[]; error: unknown }> {
    if (previewRounds.length === 0) return { data: [], error: null };
    const { data, error } = await supabase
      .from("rounds")
      .insert(
        previewRounds.map((_, i) => ({
          session_id: sessionId!,
          sequence: i + 1,
          // Only round 1 is "current" right away; any further pre-generated
          // rounds (Americano/Team Sparring/Fixed Partner/Mix Americano, all
          // of which can generate more than one round upfront) start out
          // 'planned' until play reaches them.
          status: i === 0 ? ("in_progress" as const) : ("planned" as const),
          generation_reason:
            i === 0 ? "Initial draw at session start." : "Pre-generated with the full schedule at session start.",
          seed_used: schedulingSeed + (i + 1),
        })),
      )
      .select("id, sequence");
    return { data: data ?? [], error };
  }

  const [pairsResult, roundsResult] = await Promise.all([insertPairs(), insertRounds()]);
  if (pairsResult.error) throw pairsResult.error;
  if (roundsResult.error) throw roundsResult.error;

  // Fixed Partner only — maps each tempId-space pairId to the real pairs.id
  // so match inserts below can point pair_a_id/pair_b_id at real pairs.
  const pairIdMap = new Map<string, string>();
  if (draft.pairs && draft.pairs.length > 0) {
    draft.pairs.forEach((pair, i) => pairIdMap.set(pair.pairId, pairsResult.data![i].id));
  }
  const roundIdBySequence = new Map((roundsResult.data ?? []).map((r) => [r.sequence, r.id]));

  // Every match across every round, and every resting-player row across
  // every round, built up front and bulk-inserted in ONE round trip each —
  // instead of looping round-by-round and match-by-match, each with its own
  // sequential insert (the biggest single source of lag for a multi-round
  // upfront schedule: e.g. 8 rounds x 3 courts used to be ~56 sequential
  // round trips, now it's 4 total regardless of size).
  const matchInserts: {
    round_id: string;
    court_id: string;
    status: "not_started";
    pair_a_id?: string;
    pair_b_id?: string;
  }[] = [];
  const restInserts: { round_id: string; player_id: string; consecutive_rest_count: number }[] = [];
  for (let i = 0; i < previewRounds.length; i++) {
    const previewRound = previewRounds[i];
    const roundId = roundIdBySequence.get(i + 1)!;
    for (const match of previewRound.matches) {
      const courtId = realCourtIds[match.courtIndex];
      // Fixed Partner: also stamp pair_a_id/pair_b_id (a team is always
      // exactly one intact pair for this format) — match_participants below
      // is still populated the same as every other format, so individual
      // history/standings never need to unwind a pair to work.
      const pairAId = pairIdMap.size > 0 ? pairIdMap.get(pairByTempPlayerId.get(match.teamA[0]) ?? "") : undefined;
      const pairBId = pairIdMap.size > 0 ? pairIdMap.get(pairByTempPlayerId.get(match.teamB[0]) ?? "") : undefined;
      matchInserts.push({
        round_id: roundId,
        court_id: courtId,
        status: "not_started",
        ...(pairAId && pairBId ? { pair_a_id: pairAId, pair_b_id: pairBId } : {}),
      });
    }
    for (const tempId of previewRound.restingIds) {
      restInserts.push({ round_id: roundId, player_id: playerIdMap.get(tempId)!, consecutive_rest_count: 0 });
    }
  }

  // matches (needs roundIdBySequence + realCourtIds + pairIdMap, all already
  // built) and rests (needs only roundIdBySequence) don't depend on each
  // other — insert together. round_id+court_id is unique per match across
  // the WHOLE multi-round batch (a court hosts at most one match per round),
  // so it's a safe correlation key for the participants pass below,
  // regardless of what order Postgres returns the bulk INSERT rows in.
  async function insertMatches(): Promise<{ data: { id: string; round_id: string; court_id: string }[]; error: unknown }> {
    if (matchInserts.length === 0) return { data: [], error: null };
    const { data, error } = await supabase.from("matches").insert(matchInserts).select("id, round_id, court_id");
    return { data: data ?? [], error };
  }
  async function insertRests(): Promise<{ error: unknown }> {
    if (restInserts.length === 0) return { error: null };
    const { error } = await supabase.from("round_rests").insert(restInserts);
    return { error };
  }
  const [matchesInsertResult, restsInsertResult] = await Promise.all([insertMatches(), insertRests()]);
  if (matchesInsertResult.error) throw matchesInsertResult.error;
  if (restsInsertResult.error) throw restsInsertResult.error;

  const matchIdByRoundCourt = new Map((matchesInsertResult.data ?? []).map((m) => [`${m.round_id}|${m.court_id}`, m.id]));

  const participantInserts: { match_id: string; player_id: string; side: "A" | "B" }[] = [];
  for (let i = 0; i < previewRounds.length; i++) {
    const roundId = roundIdBySequence.get(i + 1)!;
    for (const match of previewRounds[i].matches) {
      const courtId = realCourtIds[match.courtIndex];
      const matchId = matchIdByRoundCourt.get(`${roundId}|${courtId}`)!;
      participantInserts.push(
        ...match.teamA.map((tempId) => ({ match_id: matchId, player_id: playerIdMap.get(tempId)!, side: "A" as const })),
        ...match.teamB.map((tempId) => ({ match_id: matchId, player_id: playerIdMap.get(tempId)!, side: "B" as const })),
      );
    }
  }
  if (participantInserts.length > 0) {
    const { error: participantsError } = await supabase.from("match_participants").insert(participantInserts);
    if (participantsError) throw participantsError;
  }

  return { sessionId, joinCode, publicToken };
}

/**
 * Ends a live session. Doesn't touch rounds/matches — everything stays
 * exactly as scored, just marked closed (status: 'ended') so the Host Live
 * page switches to read-only (no more score entry, no Next Round) while
 * remaining fully reopenable from the home page's session list.
 */
export async function endSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}
