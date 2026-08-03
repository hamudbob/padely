// Rebuilds every player's GLOBAL Glicko-2 rating by replaying their match
// history session-by-session (each session = one rating period). Pure — the
// caller fetches the sessions; this does no I/O. Used to (re)compute ratings
// and, incrementally, to advance them one session at a time at session end.
//
// A rating is skill, so it counts EVERY match a player plays anywhere — it is
// deliberately not club-scoped (unlike the league). Inactivity/RD decay is NOT
// applied here (that's time-based, applied on a schedule by the persistence
// layer); this module computes the pure skill signal from results.

import { Glicko, RatingGame, newRating, updateRating } from "./glicko2";

export type MatchOutcome = "win_a" | "win_b" | "draw";

/** One completed 2v2 (or general N-v-N) match: player ids per side + result. */
export interface RatingMatch {
  sideA: string[];
  sideB: string[];
  outcome: MatchOutcome;
}

/** One session = one rating period; a chronological batch of its matches. */
export interface RatingSession {
  matches: RatingMatch[];
}

export interface PlayerRating extends Glicko {
  /** Total matches this player has been rated on. */
  games: number;
}

function averageOf(ids: string[], snapshot: Map<string, Glicko>): { rating: number; rd: number } {
  // Average a side's players into one virtual opponent (the doubles mapping).
  // Padel is 2v2, but this stays correct for any side size.
  const gs = ids.map((id) => snapshot.get(id)!);
  const rating = gs.reduce((s, g) => s + g.rating, 0) / gs.length;
  const rd = gs.reduce((s, g) => s + g.rd, 0) / gs.length;
  return { rating, rd };
}

/**
 * Replay all sessions in chronological order and return each player's current
 * global rating. Sessions MUST be ordered oldest → newest. Only players who
 * actually played a match are created/updated.
 */
export function computeGlobalRatings(sessions: RatingSession[]): Map<string, PlayerRating> {
  const ratings = new Map<string, PlayerRating>();

  for (const session of sessions) {
    // Everyone who played at least one match this session.
    const players = new Set<string>();
    for (const m of session.matches) {
      m.sideA.forEach((p) => players.add(p));
      m.sideB.forEach((p) => players.add(p));
    }
    if (players.size === 0) continue;

    // Snapshot pre-period ratings (opponents are evaluated at period start).
    const snapshot = new Map<string, Glicko>();
    for (const p of players) {
      const cur = ratings.get(p) ?? { ...newRating(), games: 0 };
      snapshot.set(p, { rating: cur.rating, rd: cur.rd, vol: cur.vol });
      if (!ratings.has(p)) ratings.set(p, cur);
    }

    // Build each player's games list for this period.
    const gamesByPlayer = new Map<string, RatingGame[]>();
    const push = (id: string, game: RatingGame) => {
      const list = gamesByPlayer.get(id) ?? [];
      list.push(game);
      gamesByPlayer.set(id, list);
    };
    for (const m of session.matches) {
      const scoreA = m.outcome === "win_a" ? 1 : m.outcome === "draw" ? 0.5 : 0;
      const scoreB = m.outcome === "win_b" ? 1 : m.outcome === "draw" ? 0.5 : 0;
      const oppForA = averageOf(m.sideB, snapshot);
      const oppForB = averageOf(m.sideA, snapshot);
      m.sideA.forEach((p) => push(p, { ...oppForA, score: scoreA }));
      m.sideB.forEach((p) => push(p, { ...oppForB, score: scoreB }));
    }

    // Apply the period update to every player who played.
    for (const p of players) {
      const games = gamesByPlayer.get(p) ?? [];
      const updated = updateRating(snapshot.get(p)!, games);
      const prior = ratings.get(p)!;
      ratings.set(p, { ...updated, games: prior.games + games.length });
    }
  }

  return ratings;
}

/**
 * Advance a SINGLE player's stored rating by one session's worth of games —
 * the incremental path used at session end so we never replay all history.
 * `games` carry the opponents' ratings as of the session being applied.
 */
export function advanceOneSession(current: PlayerRating, games: RatingGame[]): PlayerRating {
  const updated = updateRating({ rating: current.rating, rd: current.rd, vol: current.vol }, games);
  return { ...updated, games: current.games + games.length };
}
