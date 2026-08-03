import { supabase } from "./client";
import { Glicko, RatingGame, newRating, updateRating } from "../rating/glicko2";

/**
 * Applies the global Glicko-2 rating update for a just-ended session.
 *
 * The host's client computes each ACCOUNT player's new rating from the session's
 * final matches (using the shared engine), then submits them to the SECURITY
 * DEFINER apply_session_ratings RPC (0013), which is idempotent and owner-gated.
 *
 * - One session = one rating period; a player's opponent for a match is the
 *   AVERAGE rating of the two players on the other side, evaluated at the
 *   player's pre-session rating (snapshot).
 * - Guests (no linked account) can't hold a rating, so they aren't written — but
 *   they still act as opponents (default 1500/350) so accounts are rated fairly.
 * - Best-effort: a failure here must never block ending the session. Because the
 *   RPC is idempotent and guarded by sessions.ratings_applied, a later retry is
 *   safe and won't double-count.
 */
export async function applySessionRatings(sessionId: string): Promise<void> {
  // Rounds → final matches (+outcome) → participants → players (account link).
  const { data: rounds, error: roundsError } = await supabase.from("rounds").select("id").eq("session_id", sessionId);
  if (roundsError) throw roundsError;
  const roundIds = (rounds ?? []).map((r) => r.id);
  if (roundIds.length === 0) return;

  const [{ data: matches, error: matchesError }, { data: players, error: playersError }] = await Promise.all([
    supabase.from("matches").select("id, outcome, status").in("round_id", roundIds).eq("status", "final"),
    supabase.from("players").select("id, linked_user_id").eq("session_id", sessionId),
  ]);
  if (matchesError) throw matchesError;
  if (playersError) throw playersError;

  const finalMatches = (matches ?? []).filter((m) => m.outcome && m.outcome !== "cancelled");
  if (finalMatches.length === 0) return;

  const matchIds = finalMatches.map((m) => m.id);
  const { data: participants, error: participantsError } = await supabase
    .from("match_participants")
    .select("match_id, player_id, side")
    .in("match_id", matchIds);
  if (participantsError) throw participantsError;

  // playerId → linked account id (null for guests).
  const userByPlayer = new Map<string, string | null>((players ?? []).map((p) => [p.id, p.linked_user_id]));
  const accountUserIds = [...new Set((players ?? []).map((p) => p.linked_user_id).filter((u): u is string => !!u))];
  if (accountUserIds.length === 0) return; // nobody with an account played — nothing to rate

  // Pre-session rating snapshot per PLAYER: account → their profile, guest → default.
  const { data: profileRows, error: profilesError } = await supabase
    .from("profiles")
    .select("id, rating, rating_deviation, rating_volatility, rating_games")
    .in("id", accountUserIds);
  if (profilesError) throw profilesError;
  const profileById = new Map(
    (profileRows ?? []).map((p) => [
      p.id,
      { glicko: { rating: p.rating, rd: p.rating_deviation, vol: p.rating_volatility } as Glicko, games: p.rating_games },
    ]),
  );
  const snapshotForPlayer = (playerId: string): Glicko => {
    const userId = userByPlayer.get(playerId) ?? null;
    if (userId && profileById.has(userId)) return profileById.get(userId)!.glicko;
    return newRating(); // guest or a not-yet-created profile
  };

  // Group participants by match.
  const bySideByMatch = new Map<string, { A: string[]; B: string[] }>();
  for (const p of participants ?? []) {
    const rec = bySideByMatch.get(p.match_id) ?? { A: [], B: [] };
    (p.side === "A" ? rec.A : rec.B).push(p.player_id);
    bySideByMatch.set(p.match_id, rec);
  }
  const avg = (ids: string[]): { rating: number; rd: number } => {
    const gs = ids.map(snapshotForPlayer);
    return { rating: gs.reduce((s, g) => s + g.rating, 0) / gs.length, rd: gs.reduce((s, g) => s + g.rd, 0) / gs.length };
  };

  // Build each account player's games list for this rating period.
  const gamesByUser = new Map<string, RatingGame[]>();
  const pushGame = (playerId: string, game: RatingGame) => {
    const userId = userByPlayer.get(playerId);
    if (!userId) return; // guest — not rated
    const list = gamesByUser.get(userId) ?? [];
    list.push(game);
    gamesByUser.set(userId, list);
  };
  for (const m of finalMatches) {
    const sides = bySideByMatch.get(m.id);
    if (!sides || sides.A.length === 0 || sides.B.length === 0) continue;
    const scoreA = m.outcome === "win_a" ? 1 : m.outcome === "draw" ? 0.5 : 0;
    const scoreB = m.outcome === "win_b" ? 1 : m.outcome === "draw" ? 0.5 : 0;
    const oppForA = avg(sides.B);
    const oppForB = avg(sides.A);
    sides.A.forEach((pid) => pushGame(pid, { ...oppForA, score: scoreA }));
    sides.B.forEach((pid) => pushGame(pid, { ...oppForB, score: scoreB }));
  }

  // Compute the new rating for each account player from their pre-session base.
  const updates: { user_id: string; rating: number; rd: number; vol: number; games: number; delta: number }[] = [];
  for (const userId of accountUserIds) {
    const games = gamesByUser.get(userId) ?? [];
    if (games.length === 0) continue; // attended but rested every round — no rating change
    const prof = profileById.get(userId) ?? { glicko: newRating(), games: 0 };
    const updated = updateRating(prof.glicko, games);
    updates.push({
      user_id: userId,
      rating: updated.rating,
      rd: updated.rd,
      vol: updated.vol,
      games: prof.games + games.length,
      delta: updated.rating - prof.glicko.rating,
    });
  }
  if (updates.length === 0) return;

  const { error: rpcError } = await supabase.rpc("apply_session_ratings", { p_session_id: sessionId, p_updates: updates });
  if (rpcError) throw rpcError;
}
