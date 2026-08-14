import { supabase } from "./client";
import { applySessionRatings } from "./ratingActions";
import { applySessionResults } from "./resultActions";
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
  /** Identity, when known — the host adding themselves, or a self-joiner's email —
   * so this player's games are attributable to their account (see get_player_sessions). */
  email?: string;
  linkedUserId?: string | null;
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
  /** Optional club (team) this session is being played for (0018). */
  clubId?: string | null;
  /** Club sessions only — whether this session's results count toward the club league (0032). Defaults true. */
  countsForLeague?: boolean;
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
 * Mints a bare DRAFT session (just the row + a live join code) the instant the
 * host reaches the wizard's Players step, so the code works and people can join
 * while setup continues. Courts/players/rounds are all added later by
 * finalizeAndStart. A scheduling_seed is stored but finalizeAndStart overwrites
 * it with the one the wizard actually previewed against.
 */
export interface CreateLobbyInput {
  name: string;
  format: SessionFormat;
  scoringFormat: ScoringFormat;
  rankingBasis: RankingBasis;
  teamScoreMode?: "by_point" | "by_win" | "by_round";
  fixedPartnerStyle?: "round_robin" | "rank_based";
  /** Optional club (team) this session is being played for (0018). */
  clubId?: string | null;
  /** Club sessions only — whether this session's results count toward the club league (0032). Defaults true. */
  countsForLeague?: boolean;
}

export async function createLobby(input: CreateLobbyInput): Promise<StartSessionResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Your session expired — please log in again.");
  const user = userData.user;

  const { data: teamRow, error: teamError } = await supabase.from("teams").select("id").eq("owner_id", user.id).limit(1).single();
  if (teamError || !teamRow) throw new Error("Could not find your team — try logging out and back in.");

  const schedulingSeed = Math.floor(Math.random() * 2_000_000_000);
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
        name: input.name,
        format: input.format,
        scoring_format: input.scoringFormat,
        ranking_basis: input.rankingBasis,
        status: "draft",
        join_code: joinCode,
        public_token: publicToken,
        scheduling_seed: schedulingSeed,
        min_players_per_court: 4,
        team_score_mode: input.teamScoreMode ?? null,
        fixed_partner_style: input.fixedPartnerStyle ?? null,
        club_id: input.clubId ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (sessionError) {
      lastError = sessionError;
      if (sessionError.code === "23505") continue;
      throw sessionError;
    }
    if (!sessionRow) throw new Error("Could not create session. Try again.");
    sessionId = sessionRow.id;
  }
  if (!sessionId) throw lastError instanceof Error ? lastError : new Error("Could not create session (join code collision). Try again.");
  return { sessionId, joinCode, publicToken };
}

/**
 * Fills an existing DRAFT session (minted by createLobby) with its final config,
 * courts, roster, pairs and the already-computed round preview, then flips it
 * live. This is the wizard's "Start" once step 3 is the lobby: the preview was
 * generated from the same local roster (typed + confirmed joins), so the persist
 * logic is identical to createAndStartSession — only the session already exists.
 */
export async function finalizeAndStart(
  sessionId: string,
  draft: SessionDraft,
  previewRounds: RoundResult[],
  schedulingSeed: number,
): Promise<void> {
  const { error: cfgError } = await supabase
    .from("sessions")
    .update({
      name: draft.name,
      format: draft.format,
      scoring_format: draft.scoringFormat,
      ranking_basis: draft.rankingBasis,
      team_score_mode: draft.teamScoreMode ?? null,
      fixed_partner_style: draft.fixedPartnerStyle ?? null,
      club_id: draft.clubId ?? null,
      counts_for_league: draft.clubId ? draft.countsForLeague ?? true : false,
      scheduling_seed: schedulingSeed,
    })
    .eq("id", sessionId);
  if (cfgError) throw cfgError;

  const [{ data: courtRows, error: courtsError }, { data: playerRows, error: playersError }] = await Promise.all([
    supabase.from("courts").insert(draft.courts.map((c, i) => ({ session_id: sessionId, ordinal: i + 1, display_name: c.name, available: true }))).select("id"),
    supabase
      .from("players")
      .insert(draft.players.map((p) => ({ session_id: sessionId, display_name: p.name, gender: p.gender, team_side: p.teamSide ?? null, preferred_side: p.preferredSide ?? null, email: p.email ?? null, linked_user_id: p.linkedUserId ?? null, status: "active" as const })))
      .select("id"),
  ]);
  if (courtsError) throw courtsError;
  if (playersError) throw playersError;
  const realCourtIds = (courtRows ?? []).map((r) => r.id);
  const playerIdMap = new Map<string, string>();
  draft.players.forEach((p, i) => playerIdMap.set(p.tempId, (playerRows ?? [])[i].id));
  const pairByTempPlayerId = draft.pairs ? buildPairByPlayerId(draft.pairs) : new Map<string, string>();
  const nameByTempId = new Map(draft.players.map((p) => [p.tempId, p.name]));

  async function insertPairs(): Promise<{ data: { id: string }[]; error: unknown }> {
    if (!draft.pairs || draft.pairs.length === 0) return { data: [], error: null };
    const { data, error } = await supabase
      .from("pairs")
      .insert(draft.pairs.map((pair) => ({ session_id: sessionId, label: pairLabel(nameByTempId.get(pair.playerA) ?? "?", nameByTempId.get(pair.playerB) ?? "?"), is_auto_label: true, player_a_id: playerIdMap.get(pair.playerA)!, player_b_id: playerIdMap.get(pair.playerB)! })))
      .select("id");
    return { data: data ?? [], error };
  }
  async function insertRounds(): Promise<{ data: { id: string; sequence: number }[]; error: unknown }> {
    if (previewRounds.length === 0) return { data: [], error: null };
    const { data, error } = await supabase
      .from("rounds")
      .insert(previewRounds.map((_, i) => ({ session_id: sessionId, sequence: i + 1, status: i === 0 ? ("in_progress" as const) : ("planned" as const), generation_reason: i === 0 ? "Initial draw at session start." : "Pre-generated with the full schedule at session start.", seed_used: schedulingSeed + (i + 1) })))
      .select("id, sequence");
    return { data: data ?? [], error };
  }
  const [pairsResult, roundsResult] = await Promise.all([insertPairs(), insertRounds()]);
  if (pairsResult.error) throw pairsResult.error;
  if (roundsResult.error) throw roundsResult.error;

  const pairIdMap = new Map<string, string>();
  if (draft.pairs && draft.pairs.length > 0) draft.pairs.forEach((pair, i) => pairIdMap.set(pair.pairId, pairsResult.data![i].id));
  const roundIdBySequence = new Map((roundsResult.data ?? []).map((r) => [r.sequence, r.id]));

  const matchInserts: { round_id: string; court_id: string; status: "not_started"; pair_a_id?: string; pair_b_id?: string }[] = [];
  const restInserts: { round_id: string; player_id: string; consecutive_rest_count: number }[] = [];
  for (let i = 0; i < previewRounds.length; i++) {
    const roundId = roundIdBySequence.get(i + 1)!;
    for (const match of previewRounds[i].matches) {
      const courtId = realCourtIds[match.courtIndex];
      const pairAId = pairIdMap.size > 0 ? pairIdMap.get(pairByTempPlayerId.get(match.teamA[0]) ?? "") : undefined;
      const pairBId = pairIdMap.size > 0 ? pairIdMap.get(pairByTempPlayerId.get(match.teamB[0]) ?? "") : undefined;
      matchInserts.push({ round_id: roundId, court_id: courtId, status: "not_started", ...(pairAId && pairBId ? { pair_a_id: pairAId, pair_b_id: pairBId } : {}) });
    }
    for (const tempId of previewRounds[i].restingIds) {
      restInserts.push({ round_id: roundId, player_id: playerIdMap.get(tempId)!, consecutive_rest_count: 0 });
    }
  }
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
    const { error } = await supabase.from("match_participants").insert(participantInserts);
    if (error) throw error;
  }

  const { error: liveError } = await supabase.from("sessions").update({ status: "live", started_at: new Date().toISOString() }).eq("id", sessionId);
  if (liveError) throw liveError;

  // Team session just went live → let the club's members know (best-effort).
  if (draft.clubId) {
    try {
      await supabase.rpc("notify_club_session_started", { p_session_id: sessionId });
    } catch {
      /* notifications are non-essential — never block a successful start */
    }
  }
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
  // Apply each account player's global rating for this session. Best-effort and
  // idempotent (guarded by sessions.ratings_applied) — a failure must never
  // block ending, and a later retry can't double-count.
  await applySessionRatings(sessionId).catch((e) => {
    console.warn("Rating update deferred for session", sessionId, e);
  });
  // Record the club league results for this session (no-op for non-team
  // sessions). Best-effort + replace semantics — safe to retry, never blocks.
  await applySessionResults(sessionId).catch((e) => {
    console.warn("League results deferred for session", sessionId, e);
  });
}

/**
 * Hard-deletes a session (cascading to its courts/players/rounds/join_requests).
 * Used to clean up an abandoned DRAFT — the empty shell the create wizard mints
 * for its join code — when the host backs out without starting. Never called on
 * a live/ended session.
 */
export async function deleteSession(sessionId: string): Promise<number> {
  // Through the RPC (0040), not a table delete, because deleting a session has
  // to take its rating with it. profiles.rating is a snapshot overwritten at the
  // end of each session; the cascade removed the matches and the league rows but
  // left the points, so a test session you ran and threw away kept its spike
  // forever and the rating stopped corresponding to any game that exists.
  // Unrating and deleting belong in one transaction, which is what this is.
  //
  // Returns the number of sessions removed — 0 when the row wasn't the caller's
  // to delete — so existing callers keep working unchanged.
  const { data, error } = await supabase.rpc("delete_session_and_unrate", { p_session_id: sessionId });
  if (error) {
    // Surface the real Postgres message (Supabase errors aren't Error instances,
    // so a bare throw stringifies to "[object Object]").
    const parts = [error.message, error.details, error.hint, error.code ? `code ${error.code}` : ""].filter(Boolean);
    throw new Error(parts.join(" · "));
  }
  return typeof data === "number" ? data : 0;
}

/**
 * Live-saves the create wizard's in-progress lobby state (roster + config) onto
 * the draft session, so an accidental exit (back button, closed tab, phone
 * back) never loses the players who've been added or who joined. Best-effort:
 * a failed save must never break the wizard, so callers swallow errors.
 */
export type LobbyState = Record<string, unknown> & { players?: unknown[] };
export async function saveLobbyState(sessionId: string, state: LobbyState): Promise<void> {
  // Bump updated_at too — getResumableLobbies orders by it, so without this an
  // edited older draft wouldn't rise to the top of the "Resume setup" list.
  const { error } = await supabase
    .from("sessions")
    .update({ draft_state: state, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

export interface ResumableLobby {
  sessionId: string;
  joinCode: string;
  name: string;
  playerCount: number;
  updatedAt: string;
  draftState: LobbyState;
}

/**
 * Draft lobbies the host can resume — a draft they left with at least one
 * player already added/joined. Surfaced on Home as "Resume setup" so a dropped
 * lobby is one tap from being back exactly as it was.
 */
export async function getResumableLobbies(): Promise<ResumableLobby[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return [];
  const { data: teamRow, error: teamError } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", userData.user.id)
    .maybeSingle();
  if (teamError) throw teamError;
  if (!teamRow) return [];

  const { data: drafts, error } = await supabase
    .from("sessions")
    .select("id, name, join_code, updated_at, draft_state")
    .eq("team_id", teamRow.id)
    .eq("status", "draft")
    .not("draft_state", "is", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return (drafts ?? [])
    .map((s) => {
      const draftState = (s.draft_state ?? {}) as LobbyState;
      const players = Array.isArray(draftState.players) ? draftState.players : [];
      return {
        sessionId: s.id,
        joinCode: s.join_code,
        name: s.name,
        playerCount: players.length,
        updatedAt: s.updated_at,
        draftState,
      };
    })
    .filter((l) => l.playerCount > 0); // only lobbies that actually have people in them
}

/**
 * Housekeeping: hard-deletes the host's own draft lobbies older than
 * `olderThanDays` (default 10). Called opportunistically when Home loads, so
 * abandoned drafts (and their cascaded join_requests) never pile up — no server
 * cron needed. Best-effort; failures are swallowed by the caller.
 */
export async function sweepStaleDrafts(olderThanDays = 10): Promise<number> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return 0;
  const { data: teamRow, error: teamError } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", userData.user.id)
    .maybeSingle();
  if (teamError || !teamRow) return 0;

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: deleted, error } = await supabase
    .from("sessions")
    .delete()
    .eq("team_id", teamRow.id)
    .eq("status", "draft")
    .lt("created_at", cutoff)
    .select("id");
  if (error) throw error;
  return (deleted ?? []).length;
}


