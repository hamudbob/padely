import { supabase } from "./client";

/**
 * Per-user notification feed (0016_notifications.sql). Rows are emitted by the
 * club RPCs; here we only read them and mark them read/cleared. RLS restricts
 * everything to the signed-in user's own rows.
 */

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

function map(r: NotificationRow): AppNotification {
  return { id: r.id, type: r.type, title: r.title, body: r.body, data: r.data, read: r.read, createdAt: r.created_at };
}

/** The signed-in user's notifications, newest first. */
export async function getNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, data, read, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => map(r as NotificationRow));
}

/** Count of unread notifications — for the header badge. */
export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("read", false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("read", false);
  if (error) throw error;
}

/**
 * Opportunistic housekeeping (0034): drop the caller's own read notifications
 * older than 60 days, and anything past the newest 200. Best-effort — a failure
 * here must never stop the list rendering.
 */
export async function pruneNotifications(): Promise<number> {
  const { data, error } = await supabase.rpc("prune_notifications", { p_days: 60, p_keep: 200 });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw error;
}
