import { supabase } from "./client";
import { Glicko, RatingGame, newRating, updateRating } from "../rating/glicko2";

/**
 * Work out what one account's rating SHOULD move by for a session that has
 * already ended and already been rated — the repair for a spot claimed too
 * late (see migration 0047 for why reopening the session is the wrong answer).
 *
 * The delicate part is the opponents. When this session was rated, an unlinked
 * player counted as a default 1500 stand-in, and every rated player's
 * pre-session rating was written into rating_history.rating_before. So instead
 * of guessing, this reconstructs the exact snapshot the original run used:
 *
 *   * an opponent WITH a history row for this session → their rating_before,
 *     which is precisely what they were worth on the night;
 *   * anyone else (a guest then, a guest now) → the default 1500, the same
 *     stand-in the original run used.
 *
 * The one thing it cannot reconstruct is the claimer's own starting point:
 * their rating has moved on since. Their delta is therefore computed from
 * where they stand TODAY, which is the honest version of "this result counts
 * from now" — the alternative, back-dating into the middle of a Glicko chain,
 * would invalidate every session after it.
 */

export interface CreditPreview {
  /** What their rating becomes. */
  rating: number;
  rd: number;
  vol: number;
  /** Their new lifetime rated-game count. */
  games: number;
  /** The move, positive or negative. */
  delta: number;
  /** How many games in this session they are being credited for. */
  gamesInSession: number;
  ratingBefore: number;
}

export async function previewSessionCredit(sessionId: string, userId: string): Promise<CreditPreview> {
  const [{ data: rounds, error: roundsError }, { data: players, error: playersError }] = await Promise.all([
    supabase.from("rounds").select("id").eq("session_id", sessionId),
    supabase.from("players").select("id, linked_user_id").eq("session_id", sessionId),
  ]);
  if (roundsError) throw roundsError;
  if (playersError) throw playersError;

  const roundIds = (rounds ?? []).map((r) => r.id);
  if (roundIds.length === 0) throw new Error("That session has no rounds.");

  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id, outcome, status")
    .in("round_id", roundIds)
    .eq("status", "final");
  if (matchesError) throw matchesError;
  const finalMatches = (matches ?? []).filter((m) => m.outcome && m.outcome !== "cancelled");
  if (finalMatches.length === 0) throw new Error("That session has no finished matches.");

  const { data: participants, error: participantsError } = await supabase
    .from("match_participants")
    .select("match_id, player_id, side")
    .in(
      "match_id",
      finalMatches.map((m) => m.id),
    );
  if (participantsError) throw participantsError;

  // The pre-session snapshot, as it actually was: rating_before per user.
  const { data: history, error: historyError } = await supabase
    .from("rating_history")
    .select("user_id, rating_before, rd_before")
    .eq("session_id", sessionId);
  if (historyError) throw historyError;
  const beforeByUser = new Map(
    (history ?? []).map((h) => [h.user_id, { rating: Number(h.rating_before), rd: Number(h.rd_before) } as Glicko]),
  );

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("rating, rating_deviation, rating_volatility, rating_games")
    .eq("id", userId)
    .single();
  if (profileError) throw profileError;

  const userByPlayer = new Map((players ?? []).map((p) => [p.id, p.linked_user_id]));
  const myPlayerIds = new Set((players ?? []).filter((p) => p.linked_user_id === userId).map((p) => p.id));
  if (myPlayerIds.size === 0) throw new Error("That account doesn't hold a spot in this session yet.");

  // Everyone else is worth what they were worth on the night; a guest is worth
  // the default, exactly as the original run assumed.
  const snapshotFor = (playerId: string): Glicko => {
    const uid = userByPlayer.get(playerId);
    const seen = uid ? beforeByUser.get(uid) : undefined;
    if (!seen) return newRating();
    return { rating: seen.rating, rd: seen.rd, vol: newRating().vol };
  };

  const sides = new Map<string, { A: string[]; B: string[] }>();
  for (const p of participants ?? []) {
    const rec = sides.get(p.match_id) ?? { A: [], B: [] };
    (p.side === "A" ? rec.A : rec.B).push(p.player_id);
    sides.set(p.match_id, rec);
  }
  const avg = (ids: string[]): { rating: number; rd: number } => {
    const gs = ids.map(snapshotFor);
    return {
      rating: gs.reduce((s, g) => s + g.rating, 0) / gs.length,
      rd: gs.reduce((s, g) => s + g.rd, 0) / gs.length,
    };
  };

  const games: RatingGame[] = [];
  for (const m of finalMatches) {
    const side = sides.get(m.id);
    if (!side || side.A.length === 0 || side.B.length === 0) continue;
    const mine = side.A.some((id) => myPlayerIds.has(id)) ? "A" : side.B.some((id) => myPlayerIds.has(id)) ? "B" : null;
    if (!mine) continue;
    const score = m.outcome === "draw" ? 0.5 : (m.outcome === "win_a") === (mine === "A") ? 1 : 0;
    games.push({ ...avg(mine === "A" ? side.B : side.A), score });
  }
  if (games.length === 0) throw new Error("They never played a finished match in this session.");

  const base: Glicko = {
    rating: Number(profile.rating),
    rd: Number(profile.rating_deviation),
    vol: Number(profile.rating_volatility),
  };
  const updated = updateRating(base, games);

  return {
    rating: updated.rating,
    rd: updated.rd,
    vol: updated.vol,
    games: (profile.rating_games ?? 0) + games.length,
    delta: updated.rating - base.rating,
    gamesInSession: games.length,
    ratingBefore: base.rating,
  };
}
