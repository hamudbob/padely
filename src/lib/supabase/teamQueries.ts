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
  /** Club settings (0079). Defaults match how clubs behaved before them. */
  settings: ClubSettings;
}

/** What a new Call-up form starts with. Every field optional. */
export interface CallupDefaults {
  /** 0 = Sunday … 6 = Saturday, in the club's local time. */
  weekday?: number | null;
  /** "19:00". */
  time?: string | null;
  title?: string | null;
  location?: string | null;
  courts?: number | null;
  hours?: number | null;
  maxPlayers?: number | null;
  cost?: string | null;
  /** 0080: how the night is paid for, and the notes shown to members (bank
   *  details, QRIS…). */
  paymentMode?: "none" | "tick" | "receipt" | "prepay" | null;
  notes?: string | null;
}

/** What a new club session starts with. */
export interface SessionDefaults {
  format?: string | null;
  scoringFormat?: string | null;
  courts?: number | null;
  countsForLeague?: boolean | null;
}

export interface ClubSettings {
  joinMode: "approval" | "open";
  listed: boolean;
  maxGuests: number;
  waitlistEnabled: boolean;
  reminderMinutes: 0 | 60 | 120;
  leagueMinSessions: number;
  defaultSort: string;
  callupDefaults: CallupDefaults;
  sessionDefaults: SessionDefaults;
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
  join_mode?: string | null;
  listed?: boolean | null;
  max_guests?: number | null;
  waitlist_enabled?: boolean | null;
  reminder_minutes?: number | null;
  callup_defaults?: Record<string, unknown> | null;
  session_defaults?: Record<string, unknown> | null;
}

/** jsonb (snake_case) → CallupDefaults. Unknown or malformed fields are dropped. */
function callupFromJson(j: Record<string, unknown> | null | undefined): CallupDefaults {
  const o = j ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    weekday: num(o.weekday),
    time: typeof o.time === "string" && /^\d{2}:\d{2}$/.test(o.time) ? o.time : null,
    title: str(o.title),
    location: str(o.location),
    courts: num(o.courts),
    hours: num(o.hours),
    maxPlayers: num(o.max_players),
    cost: str(o.cost),
    paymentMode: o.payment_mode === "tick" || o.payment_mode === "receipt" || o.payment_mode === "prepay" || o.payment_mode === "none" ? o.payment_mode : null,
    notes: str(o.notes),
  };
}

function sessionFromJson(j: Record<string, unknown> | null | undefined): SessionDefaults {
  const o = j ?? {};
  return {
    format: typeof o.format === "string" ? o.format : null,
    scoringFormat: typeof o.scoring_format === "string" ? o.scoring_format : null,
    courts: typeof o.courts === "number" ? o.courts : null,
    countsForLeague: typeof o.counts_for_league === "boolean" ? o.counts_for_league : null,
  };
}

export function settingsFromRow(r: ClubRow): ClubSettings {
  const minutes = r.reminder_minutes === 0 || r.reminder_minutes === 120 ? r.reminder_minutes : 60;
  return {
    joinMode: r.join_mode === "open" ? "open" : "approval",
    listed: r.listed !== false,
    maxGuests: typeof r.max_guests === "number" ? r.max_guests : 3,
    waitlistEnabled: r.waitlist_enabled !== false,
    reminderMinutes: minutes,
    leagueMinSessions: Math.max(1, r.league_min_sessions ?? 1),
    defaultSort: r.default_sort ?? "pointsPerSession",
    callupDefaults: callupFromJson(r.callup_defaults),
    sessionDefaults: sessionFromJson(r.session_defaults),
  };
}

/** Save the club settings screen (owner and admins; 0079 update_club_settings). */
export async function saveClubSettings(
  clubId: string,
  s: ClubSettings,
  seasonChange?: { length: string; startsAt: Date } | null,
): Promise<void> {
  const c = s.callupDefaults;
  const d = s.sessionDefaults;
  const payload: Record<string, unknown> = {
    join_mode: s.joinMode,
    listed: s.listed,
    max_guests: s.maxGuests,
    waitlist_enabled: s.waitlistEnabled,
    reminder_minutes: s.reminderMinutes,
    league_min_sessions: s.leagueMinSessions,
    default_sort: s.defaultSort,
    callup_defaults: {
      weekday: c.weekday ?? null, time: c.time ?? null, title: c.title ?? null, location: c.location ?? null,
      courts: c.courts ?? null, hours: c.hours ?? null, max_players: c.maxPlayers ?? null, cost: c.cost ?? null,
      payment_mode: c.paymentMode ?? null, notes: c.notes?.trim() ? c.notes.trim().slice(0, 1000) : null,
    },
    session_defaults: {
      format: d.format ?? null, scoring_format: d.scoringFormat ?? null, courts: d.courts ?? null,
      counts_for_league: d.countsForLeague ?? null,
    },
  };
  if (seasonChange) {
    payload.season_length = seasonChange.length;
    payload.season_starts_at = seasonChange.startsAt.toISOString();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("update_club_settings", { p_club_id: clubId, p_settings: payload });
  if (error) throw new Error(error.message);
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
    settings: settingsFromRow(r),
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
