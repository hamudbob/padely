import { supabase } from "./client";

export interface HostSessionSummary {
  id: string;
  name: string;
  format: string;
  status: "draft" | "live" | "ended";
  joinCode: string;
  createdAt: string;
  endedAt: string | null;
}

/**
 * "Your Sessions" list for the home page — lets a host reopen a past
 * session (live or ended), not just create a new one. Returns [] rather
 * than throwing when nobody's logged in or a host hasn't created a team
 * yet (both are normal states, not errors).
 */
export async function listHostSessions(): Promise<HostSessionSummary[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return [];

  const { data: teamRow, error: teamError } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", userData.user.id)
    .maybeSingle();
  if (teamError) throw teamError;
  if (!teamRow) return [];

  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id, name, format, status, join_code, created_at, ended_at")
    .eq("team_id", teamRow.id)
    .order("created_at", { ascending: false });
  if (sessionsError) throw sessionsError;

  return (sessions ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    format: s.format,
    status: s.status,
    joinCode: s.join_code,
    createdAt: s.created_at,
    endedAt: s.ended_at,
  }));
}