import { supabase } from "./client";
import { assembleStandings, StandingsInput, StandingsRow } from "./standingsQueries";
import { RankingBasis } from "../scoring/standings";

/**
 * Read-only wrapper around the `get_public_session(p_public_token)` RPC
 * (SECURITY DEFINER, granted to anon + authenticated). ADDITIVE — it calls the
 * RPC and shapes the result; it never touches a table directly.
 *
 * Since migration 0011 the RPC returns the RAW standings ingredients (players +
 * status + team_side, every final match's outcome + participants, adjustments,
 * pairs, and the session's ranking_basis / scoring_format / fixed_partner_style).
 * We feed those into `assembleStandings` — the EXACT function the host's
 * Standings tab uses — so the spectator board and the host board are produced by
 * one implementation and can never disagree (rest compensation, ranking_basis,
 * integer wins, Fixed-Partner pair collapse, and zero-match players all match).
 */
export interface PublicSessionData {
  session: { id: string; name: string; format: string; scoringFormat: string; rankingBasis: RankingBasis; status: "draft" | "live" | "ended" };
  /** Only set when loaded by id (0039) — the podium needs it to link on to standings & rounds. */
  publicToken?: string | null;
  /** Only set when loaded by id (0039) — for the recap card's caption. */
  clubName?: string | null;
  sessionDate?: string | null;
  /** playerId → avatar, for the recap card's podium faces. Only set when loaded by id. */
  avatarByPlayerId?: Map<string, string | null>;
  players: { id: string; displayName: string; status: string }[];
  rounds: { id: string; sequence: number; status: string }[];
  /** Ranked leaderboard rows, computed via assembleStandings — identical to host. */
  standings: StandingsRow[];
  /** Every round's matches (per-court scores) for display, tagged with round sequence. */
  matches: {
    roundSequence: number;
    courtName: string;
    teamA: string[];
    teamB: string[];
    scoreA: number | null;
    scoreB: number | null;
    status: string;
  }[];
}

// Shape of the raw RPC payload (0011).
interface RawPublicSession {
  session?: {
    id?: string;
    name?: string;
    format?: string;
    scoring_format?: string;
    ranking_basis?: RankingBasis;
    fixed_partner_style?: string | null;
    status?: PublicSessionData["session"]["status"];
  };
  players?: { id: string; display_name: string; status: string; team_side: "A" | "B" | null; avatar_url?: string | null }[];
  public_token?: string | null;
  club_name?: string | null;
  session_date?: string | null;
  rounds?: { id: string; sequence: number; status: string }[];
  adjustments?: { player_id: string | null; pair_id: string | null; amount: number }[];
  pairs?: { id: string; player_a_id: string; player_b_id: string }[];
  matches?: {
    id: string;
    round_sequence: number;
    court_name: string;
    status: string;
    outcome: string | null;
    score_a: number | null;
    score_b: number | null;
    team_a: string[] | null;
    team_b: string[] | null;
    participants: { player_id: string; side: "A" | "B" }[] | null;
  }[];
}

export async function getPublicSession(publicToken: string): Promise<PublicSessionData | null> {
  const { data, error } = await supabase.rpc("get_public_session", { p_public_token: publicToken });
  if (error) throw error;
  if (!data) return null; // RPC returns null when the token matches nothing.
  return mapPublicSession(data as RawPublicSession);
}

/**
 * The same payload, addressed by session id instead of token (0039).
 *
 * This is what makes one podium page work for everyone. The final screen is
 * routed by id, and its old queries read `players` / `matches` directly — which
 * host-only RLS answers with an empty result, not an error. So a player opening
 * their own finished session got a podium with one name in it and no standings,
 * while the host saw the real thing on the same URL.
 */
export async function getPublicSessionById(sessionId: string): Promise<PublicSessionData | null> {
  const { data, error } = await supabase.rpc("get_public_session_by_id", { p_session_id: sessionId });
  if (error) throw error;
  if (!data) return null; // null for an unknown id, or a session still in draft.
  return mapPublicSession(data as RawPublicSession);
}

function mapPublicSession(d: RawPublicSession): PublicSessionData {
  const players = d.players ?? [];
  const matches = d.matches ?? [];
  const pairs = d.pairs ?? [];
  const adjustments = d.adjustments ?? [];

  // Build the exact input the host's engine consumes and compute standings once.
  const finalMatches = matches.filter((m) => m.status === "final");
  const participants: StandingsInput["participants"] = matches.flatMap((m) =>
    (m.participants ?? []).map((p) => ({ match_id: m.id, player_id: p.player_id, side: p.side })),
  );
  const standingsInput: StandingsInput = {
    session: {
      ranking_basis: d.session?.ranking_basis ?? "points_first",
      format: d.session?.format ?? "",
      fixed_partner_style: d.session?.fixed_partner_style ?? null,
      scoring_format: d.session?.scoring_format ?? "",
    },
    players: players.map((p) => ({ id: p.id, display_name: p.display_name, team_side: p.team_side, status: p.status })),
    finalMatches: finalMatches.map((m) => ({ id: m.id, score_a: m.score_a, score_b: m.score_b, outcome: m.outcome, status: m.status })),
    participants,
    adjustments: adjustments.map((a) => ({ player_id: a.player_id, pair_id: a.pair_id, amount: a.amount })),
    pairs: pairs.map((p) => ({ id: p.id, player_a_id: p.player_a_id, player_b_id: p.player_b_id })),
  };
  const { rows } = assembleStandings(standingsInput);

  const avatarByPlayerId = new Map<string, string | null>(
    players.filter((p) => p.avatar_url !== undefined).map((p) => [p.id, p.avatar_url ?? null]),
  );

  return {
    session: {
      id: d.session?.id ?? "",
      name: d.session?.name ?? "",
      format: d.session?.format ?? "",
      scoringFormat: d.session?.scoring_format ?? "",
      rankingBasis: d.session?.ranking_basis ?? "points_first",
      status: d.session?.status ?? "live",
    },
    publicToken: d.public_token ?? null,
    clubName: d.club_name ?? null,
    sessionDate: d.session_date ?? null,
    avatarByPlayerId: avatarByPlayerId.size > 0 ? avatarByPlayerId : undefined,
    players: players.map((p) => ({ id: p.id, displayName: p.display_name, status: p.status })),
    rounds: (d.rounds ?? []).map((r) => ({ id: r.id, sequence: r.sequence, status: r.status })),
    standings: rows,
    matches: matches.map((m) => ({
      roundSequence: m.round_sequence,
      courtName: m.court_name,
      teamA: m.team_a ?? [],
      teamB: m.team_b ?? [],
      scoreA: m.score_a,
      scoreB: m.score_b,
      status: m.status,
    })),
  };
}
