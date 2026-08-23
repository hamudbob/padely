import { supabase } from "./client";
import { getProfiles, resizeImage } from "./profileQueries";

/**
 * Teams / clubs core (0014_teams.sql). Reads go straight to the tables (public
 * to signed-in users); every membership mutation goes through a SECURITY DEFINER
 * RPC that enforces roles + the spec's limits, so nothing can be bypassed from
 * the client.
 */

export type TeamRole = "owner" | "admin" | "member";

export interface Team {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  sessionFloor: number;
  leaguePeriod: string;
  leagueMinSessions: number;
  defaultSort: string;
  createdBy: string | null;
  createdAt: string;
}

export interface MyTeam extends Team {
  myRole: TeamRole;
  memberCount: number;
}

export interface TeamMember {
  userId: string;
  role: TeamRole;
  joinedAt: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ClubRow {
  id: string;
  name: string;
  club_code: string;
  logo_url: string | null;
  session_floor: number;
  league_period: string;
  league_min_sessions: number;
  default_sort: string;
  created_by: string | null;
  created_at: string;
}

function mapTeam(r: ClubRow): Team {
  return {
    id: r.id,
    name: r.name,
    code: r.club_code,
    logoUrl: r.logo_url,
    sessionFloor: r.session_floor,
    leaguePeriod: r.league_period,
    leagueMinSessions: r.league_min_sessions,
    defaultSort: r.default_sort ?? "pointsPerSession",
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/** Create a team; the caller becomes its owner. Returns the new id + join code. */
export async function createTeam(name: string): Promise<{ id: string; code: string }> {
  const { data, error } = await supabase.rpc("create_club", { p_name: name });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { id: string; code: string };
  return { id: d.id, code: d.code };
}

/** Teams the signed-in user belongs to, with their role and member count. */
export async function getMyTeams(): Promise<MyTeam[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return [];

  const { data: mems, error: memErr } = await supabase
    .from("club_members")
    .select("club_id, role")
    .eq("user_id", userData.user.id);
  if (memErr) throw memErr;
  const rows = mems ?? [];
  if (rows.length === 0) return [];

  const clubIds = rows.map((m) => m.club_id);
  const roleByClub = new Map(rows.map((m) => [m.club_id, m.role as TeamRole]));

  const [{ data: clubs, error: clubsErr }, { data: allMems, error: allErr }] = await Promise.all([
    supabase.from("clubs").select("*").in("id", clubIds),
    supabase.from("club_members").select("club_id").in("club_id", clubIds),
  ]);
  if (clubsErr) throw clubsErr;
  if (allErr) throw allErr;

  const counts = new Map<string, number>();
  for (const m of allMems ?? []) counts.set(m.club_id, (counts.get(m.club_id) ?? 0) + 1);

  return (clubs ?? [])
    .map((t) => ({
      ...mapTeam(t as ClubRow),
      myRole: roleByClub.get(t.id) ?? "member",
      memberCount: counts.get(t.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A single team by id (null if it doesn't exist). */
export async function getTeam(teamId: string): Promise<Team | null> {
  const { data, error } = await supabase.from("clubs").select("*").eq("id", teamId).maybeSingle();
  if (error) throw error;
  return data ? mapTeam(data as ClubRow) : null;
}

/** A team's roster (owner first, then admins, then members), with names/avatars. */
export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data: mems, error } = await supabase
    .from("club_members")
    .select("user_id, role, joined_at")
    .eq("club_id", teamId);
  if (error) throw error;
  const rows = mems ?? [];
  const profiles = await getProfiles(rows.map((m) => m.user_id));

  const rank: Record<TeamRole, number> = { owner: 0, admin: 1, member: 2 };
  return rows
    .map((m) => {
      const p = profiles.get(m.user_id);
      return {
        userId: m.user_id,
        role: m.role as TeamRole,
        joinedAt: m.joined_at,
        displayName: p?.displayName ?? "Player",
        avatarUrl: p?.avatarUrl ?? null,
      };
    })
    .sort((a, b) => rank[a.role] - rank[b.role] || a.joinedAt.localeCompare(b.joinedAt));
}

/** Edit a team's name, logo, and/or default league sort (admins only — RLS). */
export async function updateTeam(
  teamId: string,
  patch: { name?: string; logoUrl?: string | null; defaultSort?: string },
): Promise<void> {
  const row: { name?: string; logo_url?: string | null; default_sort?: string; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl;
  if (patch.defaultSort !== undefined) row.default_sort = patch.defaultSort;
  const { error } = await supabase.from("clubs").update(row).eq("id", teamId);
  if (error) throw error;
}

/** Upload a team logo (admins only): resize → store at `<clubId>/logo.jpg` →
 * save the public URL on the club. Returns the cache-busted URL. */
export async function uploadClubLogo(teamId: string, file: File): Promise<string> {
  const blob = await resizeImage(file, 512);
  const path = `${teamId}/logo.jpg`;
  const { error } = await supabase.storage
    .from("club-logos")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw error;
  const { data } = supabase.storage.from("club-logos").getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  await updateTeam(teamId, { logoUrl: url });
  return url;
}

export interface TeamSession {
  id: string;
  name: string;
  status: "draft" | "live" | "ended";
  format: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  publicToken: string;
  createdBy: string | null;
  /** Who finished first, where results were recorded. Null for a session that
   *  was never ended properly, or one still live. */
  winnerName: string | null;
  /** How many players have a recorded result — 0 until the session ends. */
  fieldSize: number;
}

/** Sessions attached to a team (0018) — newest first, drafts excluded. Read
 * through the get_club_sessions RPC (0021), which is column-scoped: members get
 * only the safe fields (no join_code / draft_state / scheduling_seed) plus the
 * public_token so a non-host member can open the read-only view. */
export async function getTeamSessions(teamId: string): Promise<TeamSession[]> {
  const { data, error } = await supabase.rpc("get_club_sessions", { p_club_id: teamId });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    name: string;
    status: "draft" | "live" | "ended";
    format: string;
    created_at: string;
    started_at: string | null;
    ended_at: string | null;
    public_token: string;
    created_by: string | null;
    winner_name: string | null;
    field_size: number | null;
  }[];
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    format: s.format,
    createdAt: s.created_at,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    publicToken: s.public_token,
    createdBy: s.created_by,
    winnerName: s.winner_name ?? null,
    fieldSize: s.field_size ?? 0,
  }));
}

export interface ClubStats {
  members: number;
  sessions: number;
  games: number;
}

/** Member-gated club summary for the stats strip (0027): member count, ended
 * sessions attributed to the club, and total finalized games across them. */
export async function getClubStats(teamId: string): Promise<ClubStats> {
  const { data, error } = await supabase.rpc("get_club_stats", { p_club_id: teamId });
  if (error) throw error;
  const d = (data ?? {}) as { members?: number; sessions?: number; games?: number };
  return { members: d.members ?? 0, sessions: d.sessions ?? 0, games: d.games ?? 0 };
}

export async function leaveTeam(teamId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_club", { p_club_id: teamId });
  if (error) throw new Error(error.message);
}

export async function kickMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("club_kick_member", { p_club_id: teamId, p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function setMemberRole(teamId: string, userId: string, role: "admin" | "member"): Promise<void> {
  const { error } = await supabase.rpc("club_set_member_role", { p_club_id: teamId, p_user_id: userId, p_role: role });
  if (error) throw new Error(error.message);
}
