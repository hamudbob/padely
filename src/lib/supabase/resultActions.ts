import { supabase } from "./client";
import { getSessionStandings } from "./standingsQueries";
import { newRating, winProbability } from "../rating/glicko2";

/**
 * Records a club session's final per-member standings into session_results
 * (0019/0021) so the club league board can aggregate them without every member
 * reading the host-only detail tables.
 *
 * The host's client computes the session's final standings (the SAME
 * assembleStandings the live table uses), maps each MEMBER (account-linked
 * player who is a current member of the club) to their ranked subject, and
 * submits the rows to the SECURITY DEFINER apply_session_results RPC
 * (owner-gated, ended-only, once-only).
 *
 * Only CURRENT club members are written (audit #1) — a signed-in non-member who
 * joined by code never lands on the league board. Guests (no account) are
 * excluded too.
 *
 * League scoring (decided design §6.2):
 *   placement_points = field_size − rank + 1
 *   podium_bonus     = +3 / +2 / +1 for rank 1 / 2 / 3, else 0
 * plus perf_adj — an opponent-adjusted per-session performance in [0,1]
 * (actual vs Glicko-expected result against the fields actually faced), the
 * input to Club Score (audit #9).
 *
 * Best-effort: a failure here must never block ending the session.
 */
export async function applySessionResults(sessionId: string): Promise<void> {
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("club_id, format, fixed_partner_style")
    .eq("id", sessionId)
    .single();
  if (sessionError) throw sessionError;
  if (!session?.club_id) return; // not a team session — nothing to record

  const [{ data: players, error: playersError }, standings, { data: memberRows, error: memberError }] = await Promise.all([
    supabase.from("players").select("id, linked_user_id, status").eq("session_id", sessionId),
    getSessionStandings(sessionId),
    supabase.from("club_members").select("user_id").eq("club_id", session.club_id),
  ]);
  if (playersError) throw playersError;
  if (memberError) throw memberError;

  const memberSet = new Set((memberRows ?? []).map((m) => m.user_id));

  // playerId → account id, for every linked player (needed for opponent ratings).
  const userByPlayer = new Map<string, string>();
  for (const p of players ?? []) {
    if (p.linked_user_id) userByPlayer.set(p.id, p.linked_user_id);
  }
  // The members we actually write a league row for: linked AND a current member.
  const memberByPlayer = new Map<string, string>();
  for (const [playerId, userId] of userByPlayer) {
    if (memberSet.has(userId)) memberByPlayer.set(playerId, userId);
  }
  if (memberByPlayer.size === 0) return; // no current members played — nothing for the league

  const playerCount = (players ?? []).length;

  // Map each player to the standings SUBJECT (self for individual formats, the
  // pair for Fixed Partner) so both partners inherit the pair's rank.
  const isFixedPartner = session.fixed_partner_style !== null || session.format === "fixed_partner";
  const subjectByPlayer = new Map<string, string>();
  if (isFixedPartner) {
    const { data: pairs, error: pairsError } = await supabase
      .from("pairs")
      .select("id, player_a_id, player_b_id")
      .eq("session_id", sessionId);
    if (pairsError) throw pairsError;
    for (const pr of pairs ?? []) {
      subjectByPlayer.set(pr.player_a_id, pr.id);
      subjectByPlayer.set(pr.player_b_id, pr.id);
    }
  } else {
    for (const pid of memberByPlayer.keys()) subjectByPlayer.set(pid, pid);
  }

  const rowBySubject = new Map(standings.rows.map((r) => [r.subjectId, r]));
  const fieldSize = standings.rows.length;
  if (fieldSize === 0) return;

  // ---- Opponent-adjusted per-player performance (perf_adj) ---------------
  const perfByPlayer = await computePerfAdj(sessionId, userByPlayer);

  // Build one row per member (first mapped subject wins).
  const seen = new Set<string>();
  const rows: {
    user_id: string;
    rank: number;
    field_size: number;
    player_count: number;
    placement_points: number;
    podium_bonus: number;
    wins: number;
    losses: number;
    draws: number;
    scored_points: number;
    perf_adj: number;
  }[] = [];
  for (const [playerId, userId] of memberByPlayer) {
    if (seen.has(userId)) continue;
    const subjectId = subjectByPlayer.get(playerId);
    if (!subjectId) continue;
    const row = rowBySubject.get(subjectId);
    if (!row) continue;
    seen.add(userId);
    const podiumBonus = row.rank === 1 ? 3 : row.rank === 2 ? 2 : row.rank === 3 ? 1 : 0;
    rows.push({
      user_id: userId,
      rank: row.rank,
      field_size: fieldSize,
      player_count: playerCount,
      placement_points: Math.max(0, fieldSize - row.rank + 1),
      podium_bonus: podiumBonus,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      scored_points: row.compensatedPoints,
      perf_adj: perfByPlayer.get(playerId) ?? 0.5,
    });
  }
  if (rows.length === 0) return;

  const { error: rpcError } = await supabase.rpc("apply_session_results", { p_session_id: sessionId, p_rows: rows });
  if (rpcError) throw rpcError;
}

/**
 * Per-player opponent-adjusted performance in [0,1]: for each final match a
 * player played, expected score = Glicko win-probability of their pre-session
 * rating vs the opposing side's average pre-session rating; residual =
 * actual − expected, averaged, mapped to [0,1] (0.5 = exactly as expected,
 * >0.5 = over-performed a strong field). 0.5 when they played no rated match.
 * Guests/opponents without a profile default to a fresh 1500/350 rating, so
 * they still anchor the opponent strength.
 */
async function computePerfAdj(sessionId: string, userByPlayer: Map<string, string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data: rounds } = await supabase.from("rounds").select("id").eq("session_id", sessionId);
  const roundIds = (rounds ?? []).map((r) => r.id);
  if (roundIds.length === 0) return out;

  const { data: matches } = await supabase
    .from("matches")
    .select("id, outcome, status")
    .in("round_id", roundIds)
    .eq("status", "final");
  const finalMatches = (matches ?? []).filter((m) => m.outcome && m.outcome !== "cancelled");
  if (finalMatches.length === 0) return out;

  const matchIds = finalMatches.map((m) => m.id);
  const { data: participants } = await supabase
    .from("match_participants")
    .select("match_id, player_id, side")
    .in("match_id", matchIds);

  const userIds = [...new Set(userByPlayer.values())];
  const ratingByUser = new Map<string, number>();
  if (userIds.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, rating").in("id", userIds);
    for (const p of profs ?? []) ratingByUser.set(p.id, p.rating);
  }
  const ratingForPlayer = (playerId: string): number => {
    const uid = userByPlayer.get(playerId);
    if (uid && ratingByUser.has(uid)) return ratingByUser.get(uid)!;
    return newRating().rating; // guest / no profile → default 1500
  };

  const bySide = new Map<string, { A: string[]; B: string[] }>();
  for (const p of participants ?? []) {
    const rec = bySide.get(p.match_id) ?? { A: [], B: [] };
    (p.side === "A" ? rec.A : rec.B).push(p.player_id);
    bySide.set(p.match_id, rec);
  }
  const avg = (ids: string[]): number => (ids.length === 0 ? newRating().rating : ids.reduce((s, id) => s + ratingForPlayer(id), 0) / ids.length);

  const acc = new Map<string, { sum: number; n: number }>();
  for (const m of finalMatches) {
    const sides = bySide.get(m.id);
    if (!sides || sides.A.length === 0 || sides.B.length === 0) continue;
    const oppAvgForA = avg(sides.B);
    const oppAvgForB = avg(sides.A);
    const actualA = m.outcome === "win_a" ? 1 : m.outcome === "draw" ? 0.5 : 0;
    const actualB = m.outcome === "win_b" ? 1 : m.outcome === "draw" ? 0.5 : 0;
    for (const pid of sides.A) {
      const expected = winProbability(ratingForPlayer(pid), oppAvgForA);
      const a = acc.get(pid) ?? { sum: 0, n: 0 };
      a.sum += actualA - expected;
      a.n += 1;
      acc.set(pid, a);
    }
    for (const pid of sides.B) {
      const expected = winProbability(ratingForPlayer(pid), oppAvgForB);
      const a = acc.get(pid) ?? { sum: 0, n: 0 };
      a.sum += actualB - expected;
      a.n += 1;
      acc.set(pid, a);
    }
  }
  for (const [pid, a] of acc) {
    const avgResidual = a.n > 0 ? a.sum / a.n : 0; // in [-1, 1]
    out.set(pid, Math.max(0, Math.min(1, 0.5 + avgResidual / 2)));
  }
  return out;
}
