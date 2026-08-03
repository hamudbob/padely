// Glicko-2 skill rating (Glickman 2001). Pure — no React, no Supabase, no I/O.
// This is the single source of truth for the player skill number described in the
// Phase-2 ranking spec: a GLOBAL rating updated once per session (a "rating
// period"), immune to field size, opponent-aware, and self-correcting.
//
// Doubles (2v2) mapping: for each match a player plays, their opponent is the
// AVERAGE rating/RD of the two players on the other side, with score 1 / 0.5 / 0.
// Both partners on a side update independently against their own opponent-average.
//
// The rating NEVER resets. Missing a period only grows uncertainty (see
// applyInactivity) so a returning player can move again — it never subtracts.

/** A player's three Glicko-2 numbers. Display uses `rating`; the others are the
 * engine's uncertainty state and must be persisted alongside it. */
export interface Glicko {
  /** Skill estimate on the familiar ~1500 scale. */
  rating: number;
  /** Rating deviation — how unsure we are (starts high, shrinks with play). */
  rd: number;
  /** Volatility — how erratic recent results have been. */
  vol: number;
}

/** One opponent a player faced in a rating period, with the result. */
export interface RatingGame {
  /** Opponent's rating at the START of the period (snapshot). For doubles this
   * is the average of the two opposing players' ratings. */
  rating: number;
  /** Opponent's rating deviation (average of the opposing pair for doubles). */
  rd: number;
  /** Result for THIS player: 1 win, 0.5 draw, 0 loss. */
  score: number;
}

// ---- Tunable constants (spec §1.2) --------------------------------------
export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
/** System constant τ: smaller = steadier ratings. Range 0.3–1.2. */
export const TAU = 0.5;
/** Above this RD a player is still "provisional" (~first 5 games). */
export const PROVISIONAL_RD = 110;
/** Hard cap on RD so an idle player never becomes infinitely uncertain. */
export const MAX_RD = 350;

const SCALE = 173.7178; // Glicko-2 internal scale factor

export function newRating(): Glicko {
  return { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };
}

export function isProvisional(g: Glicko): boolean {
  return g.rd > PROVISIONAL_RD;
}

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expectedScore = (mu: number, muj: number, phij: number): number =>
  1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/**
 * Update one player's rating from all the games they played in a single rating
 * period (one session). Returns the new Glicko state. If `games` is empty the
 * player sat the period out — see applyInactivity (call that instead per idle
 * period). Faithful to the published Glicko-2 algorithm, including the Illinois
 * root-find for the new volatility.
 */
export function updateRating(player: Glicko, games: RatingGame[]): Glicko {
  if (games.length === 0) return applyInactivity(player);

  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  // Step 3–4: estimated variance v and improvement Δ.
  let vInv = 0;
  let deltaSum = 0;
  for (const gm of games) {
    const muj = (gm.rating - DEFAULT_RATING) / SCALE;
    const phij = gm.rd / SCALE;
    const gPhij = g(phij);
    const E = expectedScore(mu, muj, phij);
    vInv += gPhij * gPhij * E * (1 - E);
    deltaSum += gPhij * (gm.score - E);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility σ′ via the Illinois algorithm.
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaP = Math.exp(A / 2);

  // Step 6: new RD and rating.
  const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
  const phiP = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muP = mu + phiP * phiP * deltaSum;

  return {
    rating: muP * SCALE + DEFAULT_RATING,
    rd: Math.min(phiP * SCALE, MAX_RD),
    vol: sigmaP,
  };
}

/**
 * Grow a player's uncertainty for one period they didn't play. Rating and
 * volatility are unchanged; RD widens toward the cap so a returning player's
 * next result moves them more (correctly — we're less sure of them now).
 * Call once per idle rating period.
 */
export function applyInactivity(player: Glicko): Glicko {
  const phi = player.rd / SCALE;
  const phiStar = Math.sqrt(phi * phi + player.vol * player.vol);
  return { rating: player.rating, rd: Math.min(phiStar * SCALE, MAX_RD), vol: player.vol };
}

/** Average two opponents into one virtual opponent (the doubles mapping). */
export function averageOpponent(a: Glicko, b: Glicko): { rating: number; rd: number } {
  return { rating: (a.rating + b.rating) / 2, rd: (a.rd + b.rd) / 2 };
}

/** Win probability of side A (avg ratingA) vs side B (avg ratingB) — for display
 * and seeding only, not part of the update. Standard Elo logistic. */
export function winProbability(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}
