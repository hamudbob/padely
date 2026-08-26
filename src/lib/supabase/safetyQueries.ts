import { supabase } from "./client";

/**
 * Reporting and blocking (0053) — the two things both stores require of an app
 * where strangers can see each other's photo and free text.
 *
 * A block is content and contact, not presence. It hides profiles in both
 * directions and withdraws pending club invitations; it never touches a session
 * the two people both played. Two people who turned up are on the same court
 * whatever the database thinks, and a scoreboard that disagrees with the court
 * is worse than an uncomfortable evening.
 *
 * A block is also silent. Only the blocker is ever told one exists.
 */

export type ReportReason =
  | "abuse"
  | "impersonation"
  | "inappropriate_photo"
  | "inappropriate_name"
  | "spam"
  | "other";

/** What each reason says on screen. Written as the reporter would say it, not
 *  as a policy document would. */
export const REPORT_REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "abuse", label: "Abusive or threatening", hint: "Messages, names or bio aimed at someone" },
  { value: "inappropriate_photo", label: "Inappropriate photo", hint: "Sexual, violent or someone else's picture" },
  { value: "inappropriate_name", label: "Inappropriate name or bio", hint: "Slurs, or text meant to offend" },
  { value: "impersonation", label: "Pretending to be someone", hint: "Using a real person's name or face" },
  { value: "spam", label: "Spam or advertising", hint: "Promoting something, repeatedly" },
  { value: "other", label: "Something else", hint: "Tell us what, and we'll read it" },
];

export interface BlockedPlayer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("block_user", { p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("unblock_user", { p_user_id: userId });
  if (error) throw new Error(error.message);
}

/** The list behind Settings → Blocked players. Real names, deliberately: this
 *  is the one place a blocker must still be able to tell who is who, or the
 *  list is a row of identical "Player" entries and unblocking is a guess. */
export async function getMyBlocks(): Promise<BlockedPlayer[]> {
  const { data, error } = await supabase.rpc("my_blocks");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; display_name: string | null; avatar_url: string | null; blocked_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name ?? "Player",
    avatarUrl: r.avatar_url,
    blockedAt: r.blocked_at,
  }));
}

export async function reportUser(userId: string, reason: ReportReason, detail?: string): Promise<void> {
  const { error } = await supabase.rpc("report_user", {
    p_user_id: userId,
    p_reason: reason,
    p_detail: detail?.trim() || null,
  });
  if (error) throw new Error(error.message);
}
