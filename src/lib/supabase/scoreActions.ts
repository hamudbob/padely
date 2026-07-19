import { supabase } from "./client";
import { validateAndDeriveScore, ScoringFormat } from "../scoring/formats";

export interface SubmitScoreInput {
  matchId: string;
  format: ScoringFormat;
  scoreA: number | null;
  scoreB: number | null;
  editedBy: string; // auth.uid() of the host saving this
  reason?: string;
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

  const { data: existing, error: fetchError } = await supabase
    .from("matches")
    .select("score_a, score_b, status")
    .eq("id", input.matchId)
    .single();
  if (fetchError) throw fetchError;

  const wasFinal = existing.status === "final";

  const { error: updateError } = await supabase
    .from("matches")
    .update({
      score_a: input.scoreA,
      score_b: finalScoreB,
      outcome: validation.outcome,
      status: "final",
      updated_at: new Date().toISOString(),
    })
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