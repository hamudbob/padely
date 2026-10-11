import { supabase } from "./client";
import { validateAndDeriveScore, ScoringFormat } from "../scoring/formats";

export interface SubmitScoreInput {
  matchId: string;
  format: ScoringFormat;
  scoreA: number | null;
  scoreB: number | null;
  editedBy: string; // auth.uid() of the host saving this
  reason?: string;
  /**
   * When the host TAPPED this score (ms). A score queued offline reaches the
   * server later; if a co-host entered one for the same match in between,
   * theirs is newer and this one is dropped rather than written over it.
   */
  scoredAt?: number;
}

/**
 * Validates + saves a match score, and — if the match was already Final —
 * records the old/new values in score_edits (PRD §10: "every score edit
 * stores old/new score, editor, time, reason").
 */
export async function submitMatchScore(input: SubmitScoreInput): Promise<void> {
  const validation = validateAndDeriveScore(input.format, { scoreA: input.scoreA, scoreB: input.scoreB });
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid score.");
  }
  const finalScoreB = validation.derivedScoreB ?? input.scoreB;
  if (finalScoreB === null || finalScoreB === undefined) {
    throw new Error("Enter both teams' scores.");
  }

  // "*" rather than a column list: scored_at/scored_by exist only once 0071
  // is applied, and naming them before then would fail every score.
  const { data: existingRow, error: fetchError } = await supabase
    .from("matches")
    .select("*")
    .eq("id", input.matchId)
    .single();
  if (fetchError) throw fetchError;
  if (!existingRow) throw new Error("Match not found.");
  const existing = existingRow as typeof existingRow & { scored_at?: string | null };
  const hasScoredAt = "scored_at" in existing;

  // A co-host entered a score for this match AFTER this one was tapped (0071).
  // Theirs stands; the host's phone picks it up on its next pull.
  const tappedAt = input.scoredAt ?? Date.now();
  if (existing.status === "final" && existing.scored_at && Date.parse(existing.scored_at) > tappedAt) {
    return;
  }

  const wasFinal = existing.status === "final";

  const { error: updateError } = await supabase
    .from("matches")
    .update({
      score_a: input.scoreA,
      score_b: finalScoreB,
      outcome: validation.outcome,
      status: "final",
      updated_at: new Date().toISOString(),
      ...(hasScoredAt ? { scored_at: new Date(tappedAt).toISOString(), scored_by: input.editedBy || null } : {}),
    } as never)
    .eq("id", input.matchId);
  if (updateError) throw updateError;

  if (wasFinal) {
    const { error: editError } = await supabase.from("score_edits").insert({
      match_id: input.matchId,
      old_score_a: existing.score_a,
      old_score_b: existing.score_b,
      new_score_a: input.scoreA,
      new_score_b: finalScoreB,
      edited_by: input.editedBy,
      reason: input.reason ?? null,
    });
    if (editError) throw editError;
  }
}
