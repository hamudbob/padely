import { supabase } from "./client";
import { getProfiles } from "./profileQueries";

/**
 * Team (club) discovery & joining — search, join-by-code, join requests, and
 * invites. Backed by 0015_club_joining.sql. Reads honour RLS (you see your own
 * requests/invites; admins see their club's); every mutation is a SECURITY
 * DEFINER RPC that enforces roles + limits.
 */

export interface ClubSearchResult {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  memberCount: number;
  isMember: boolean;
  requested: boolean;
}

export interface JoinRequestItem {
  id: string;
  clubId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface InviteItem {
  id: string;
  clubId: string;
  clubName: string;
  inviterName: string | null;
  createdAt: string;
}

/** Search public teams by name; annotates each with my membership/request state.
 * Goes through the search_clubs RPC (0021) so member counts don't require reading
 * other clubs' rosters (club_members is no longer world-readable). */
export async function searchClubs(query: string): Promise<ClubSearchResult[]> {
  const { data, error } = await supabase.rpc("search_clubs", { p_query: query.trim() });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    name: string;
    club_code: string;
    logo_url: string | null;
    member_count: number;
    is_member: boolean;
    requested: boolean;
  }[];
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.club_code,
    logoUrl: c.logo_url,
    memberCount: Number(c.member_count ?? 0),
    isMember: c.is_member,
    requested: c.requested,
  }));
}

/** Ask to join a team you found by search. */
export async function requestToJoin(clubId: string): Promise<void> {
  const { error } = await supabase.rpc("request_to_join_club", { p_club_id: clubId });
  if (error) throw new Error(error.message);
}

/** Resolve a team code and file a join request. */
export async function joinByCode(code: string): Promise<{ clubId: string; name: string; alreadyMember: boolean; alreadyRequested: boolean }> {
  const { data, error } = await supabase.rpc("join_club_by_code", { p_code: code });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { club_id: string; name: string; already_member?: boolean; already_requested?: boolean };
  return { clubId: d.club_id, name: d.name, alreadyMember: !!d.already_member, alreadyRequested: !!d.already_requested };
}

/** Pending join requests for a club (admins only, via RLS). */
export async function getClubJoinRequests(clubId: string): Promise<JoinRequestItem[]> {
  const { data, error } = await supabase
    .from("club_join_requests")
    .select("id, club_id, user_id, created_at")
    .eq("club_id", clubId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  return rows.map((r) => {
    const p = profiles.get(r.user_id);
    return {
      id: r.id,
      clubId: r.club_id,
      userId: r.user_id,
      displayName: p?.displayName ?? "Player",
      avatarUrl: p?.avatarUrl ?? null,
      createdAt: r.created_at,
    };
  });
}

export async function respondJoinRequest(requestId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_join_request", { p_request_id: requestId, p_accept: accept });
  if (error) throw new Error(error.message);
}

/** Invite an existing account (by email) to a team you admin. */
export async function inviteByEmail(clubId: string, email: string): Promise<void> {
  const { error } = await supabase.rpc("invite_by_email", { p_club_id: clubId, p_email: email });
  if (error) throw new Error(error.message);
}

/** Invites addressed to the signed-in user (pending). */
export async function getMyInvites(): Promise<InviteItem[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from("club_invites")
    .select("id, club_id, inviter_id, created_at")
    .eq("invitee_id", userData.user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const clubIds = [...new Set(rows.map((r) => r.club_id))];
  const inviterIds = rows.map((r) => r.inviter_id).filter((x): x is string => !!x);
  const [{ data: clubs }, inviterProfiles] = await Promise.all([
    supabase.from("clubs").select("id, name").in("id", clubIds),
    getProfiles(inviterIds),
  ]);
  const clubName = new Map((clubs ?? []).map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: r.id,
    clubId: r.club_id,
    clubName: clubName.get(r.club_id) ?? "Team",
    inviterName: r.inviter_id ? inviterProfiles.get(r.inviter_id)?.displayName ?? null : null,
    createdAt: r.created_at,
  }));
}

export async function respondInvite(inviteId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_club_invite", { p_invite_id: inviteId, p_accept: accept });
  if (error) throw new Error(error.message);
}
