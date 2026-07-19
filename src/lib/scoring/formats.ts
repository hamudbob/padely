// Format-specific score validation + autofill (PRD §4 Match scoring rules).
// Pure functions — no UI, no Supabase. The score picker component calls these.

export type ScoringFormat = "fixed_21" | "fixed_4_games" | "fixed_5_games" | "race_4" | "race_6";

export interface ScoreInput {
  scoreA: number | null;
  scoreB: number | null;
}

export interface ScoreValidationResult {
  valid: boolean;
  /** For formats where entering one side derives the other (Fixed 21). */
  derivedScoreB?: number;
  outcome?: "win_a" | "win_b" | "draw";
  error?: string;
}

export function validateAndDeriveScore(format: ScoringFormat, input: ScoreInput): ScoreValidationResult {
  switch (format) {
    case "fixed_21":
      return validateFixed21(input);
    case "fixed_4_games":
      return validateFixedGames(input, 4);
    case "fixed_5_games":
      return validateFixedGames(input, 5);
    case "race_4":
      return validateRace(input, 4);
    case "race_6":
      return validateRace(input, 6);
  }
}

function validateFixed21({ scoreA }: ScoreInput): ScoreValidationResult {
  if (scoreA === null) return { valid: false, error: "Enter Team A's score." };
  if (!Number.isInteger(scoreA) || scoreA < 0 || scoreA > 21) {
    return { valid: false, error: "Score must be an integer from 0 to 21." };
  }
  const scoreB = 21 - scoreA;
  const outcome = scoreA === scoreB ? "draw" : scoreA > scoreB ? "win_a" : "win_b";
  // 21 is odd-total-agnostic here: since B = 21-A, A===B is impossible (21 is odd),
  // so "draw" can never actually occur for fixed_21 — included only for type completeness.
  return { valid: true, derivedScoreB: scoreB, outcome };
}

function validateFixedGames({ scoreA, scoreB }: ScoreInput, total: number): ScoreValidationResult {
  if (scoreA === null) return { valid: false, error: "Enter Team A's game total." };
  if (!Number.isInteger(scoreA) || scoreA < 0 || scoreA > total) {
    return { valid: false, error: `Score must be an integer from 0 to ${total}.` };
  }

  // Auto-fill: same pattern as Fixed 21 — Team B's total is derived as
  // (total - A) whenever B hasn't been entered, so the host only ever
  // taps once. Still accepts an explicit B (e.g. a future manual-entry
  // path) and validates it the old way if one is supplied.
  if (scoreB === null) {
    const derivedScoreB = total - scoreA;
    const outcome = scoreA === derivedScoreB ? "draw" : scoreA > derivedScoreB ? "win_a" : "win_b";
    return { valid: true, derivedScoreB, outcome };
  }

  if (!Number.isInteger(scoreB) || scoreB < 0) {
    return { valid: false, error: "Game totals must be non-negative integers." };
  }
  if (scoreA + scoreB !== total) {
    return { valid: false, error: `Total games must sum to ${total} (e.g. ${total}-0, ${total - 1}-1...).` };
  }
  const outcome = scoreA === scoreB ? "draw" : scoreA > scoreB ? "win_a" : "win_b";
  return { valid: true, outcome };
}

function validateRace({ scoreA, scoreB }: ScoreInput, target: number): ScoreValidationResult {
  if (scoreA === null || scoreB === null) return { valid: false, error: "Enter both teams' scores." };
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return { valid: false, error: "Scores must be non-negative integers." };
  }
  const winnerScore = Math.max(scoreA, scoreB);
  const loserScore = Math.min(scoreA, scoreB);
  if (winnerScore !== target) {
    return { valid: false, error: `Winner must have exactly ${target}.` };
  }
  if (loserScore < 0 || loserScore >= target) {
    return { valid: false, error: `Loser's score must be between 0 and ${target - 1} (no win-by-two).` };
  }
  if (scoreA === scoreB) {
    return { valid: false, error: "A race format cannot end in a draw." };
  }
  const outcome = scoreA > scoreB ? "win_a" : "win_b";
  return { valid: true, outcome };
}

/** The number picker's valid range per format — used to grey out invalid cells (correction #5). */
export function scoreRangeForFormat(format: ScoringFormat): { min: number; max: number } {
  switch (format) {
    case "fixed_21":
      return { min: 0, max: 21 };
    case "fixed_4_games":
      return { min: 0, max: 4 };
    case "fixed_5_games":
      return { min: 0, max: 5 };
    case "race_4":
      return { min: 0, max: 4 };
    case "race_6":
      return { min: 0, max: 6 };
  }
}

/**
 * Whether Team B's score is derived automatically from Team A's — every
 * fixed-sum format (Fixed 21, Fixed 4 games, Fixed 5 games) qualifies,
 * since B = total - A for all three. Race formats don't: there's no fixed
 * total to derive a loser's score from, so both sides must be entered.
 */
export function isAutoFillFormat(format: ScoringFormat): boolean {
  return format === "fixed_21" || format === "fixed_4_games" || format === "fixed_5_games";
}
