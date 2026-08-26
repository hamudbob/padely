import { supabase } from "./client";

/**
 * The admin dashboard's data layer (0041_admin.sql).
 *
 * Every function here calls a SECURITY DEFINER RPC that checks `is_admin` on
 * the server before returning anything. That check is the real gate — the
 * route guard in the UI is only there so a non-admin sees a sensible page
 * instead of a wall of errors. Shipping the admin screens in everyone's
 * bundle is fine precisely because the frontend holds no authority.
 */

type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ── Types ────────────────────────────────────────────────────────────────
export interface AdminOverview {
  generated_at: string;
  users: number;
  users_deleted: number;
  users_new_7d: number;
  users_active_30d: number;
  sessions_total: number;
  sessions_live: number;
  sessions_draft: number;
  sessions_ended: number;
  sessions_7d: number;
  matches_final: number;
  clubs: number;
  errors_24h: number;
  errors_open: number;
  admins: number;
  formats: { format: string; n: number }[];
  daily: { day: string; sessions: number }[];
}

export interface HealthCheck {
  key: string;
  label: string;
  /** Why this matters — written where the check is defined, so the dashboard
   *  explains itself rather than showing a number with no context. */
  why: string;
  count: number;
  sample: Record<string, unknown>[];
}

export interface AdminUser {
  id: string;
  display_name: string;
  email: string | null;
  rating: number;
  rating_games: number;
  is_admin: boolean;
  created_at: string;
  deleted_at: string | null;
  sessions_hosted: number;
  sessions_played: number;
  rated_sessions: number;
  clubs: number;
  errors_7d: number;
  last_active: string;
}

export interface AdminUserDetail {
  profile: {
    id: string;
    display_name: string;
    email: string | null;
    avatar_url: string | null;
    bio: string | null;
    rating: number;
    rating_deviation: number;
    rating_volatility: number;
    rating_games: number;
    is_admin: boolean;
    onboarded_at: string | null;
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  diagnosis: {
    linked_player_rows: number;
    confirmed_join_requests: number;
    history_rows: number;
    /** Rows whose session still exists. The only ones that mean anything —
     *  a row with a deleted session (history_orphaned) is debris the FK left
     *  behind, and treating it as history is what 0042 fixed. */
    history_live: number;
    history_orphaned: number;
    sessions_hosted: number;
    league_rows: number;
  };
  rating_history: {
    id: string;
    session_id: string | null;
    session_name: string | null;
    rating: number;
    delta: number | null;
    rating_before: number | null;
    games_before: number | null;
    games_after: number | null;
    created_at: string;
  }[];
  sessions: {
    id: string;
    name: string;
    format: string;
    status: string;
    created_at: string;
    ended_at: string | null;
    hosted: boolean;
    ratings_applied: boolean;
    results_applied: boolean;
  }[];
  clubs: { id: string; name: string; role: string; joined_at: string }[];
  errors: { id: number; kind: string; message: string; route: string | null; created_at: string }[];
  admin_actions: { action: string; detail: Record<string, unknown> | null; created_at: string }[];
}

export interface AdminSession {
  id: string;
  name: string;
  format: string;
  scoring_format: string;
  status: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  public_token: string | null;
  counts_for_league: boolean | null;
  ratings_applied: boolean;
  results_applied: boolean;
  created_by: string | null;
  host_name: string | null;
  club_name: string | null;
  players: number;
  accounts: number;
  rounds: number;
  final_matches: number;
}

export interface ActivityItem {
  kind:
    | "session_created"
    | "session_ended"
    | "account_created"
    | "club_created"
    | "club_joined"
    | "score_edited"
    | "claim"
    | "error"
    | "admin_action";
  at: string;
  ref: string | null;
  detail: Record<string, unknown>;
}

export interface ErrorGroup {
  fingerprint: string;
  /** The PLR-… code the user was shown. Null for anything logged before 0045. */
  code: string | null;
  /** How many of these someone pressed "Report this" on — the difference
   *  between an error that HAPPENED and one that was NOTICED. */
  reported: number;
  first_seen: string;
  last_seen: string;
  occurrences: number;
  users: number;
  open: boolean;
  message: string;
  kind: string;
  route: string | null;
  stack: string | null;
  app_version: string | null;
}

// ── Reads ────────────────────────────────────────────────────────────────

/** Is the signed-in account an admin? The same check the RPCs make. */
export async function amIAdmin(): Promise<boolean> {
  try {
    return (await call<boolean>("is_app_admin")) === true;
  } catch {
    // A missing function (migration not applied) or a signed-out caller both
    // mean "no", and neither should look like a crash.
    return false;
  }
}

export const getAdminOverview = () => call<AdminOverview>("admin_overview");
export const getAdminHealth = () => call<HealthCheck[]>("admin_health");
export const getAdminUsers = (query?: string, limit = 50) =>
  call<AdminUser[]>("admin_users", { p_query: query?.trim() || null, p_limit: limit });
export const getAdminUserDetail = (userId: string) =>
  call<AdminUserDetail>("admin_user_detail", { p_user_id: userId });
export const getAdminSessions = (status?: string, limit = 50) =>
  call<AdminSession[]>("admin_sessions", { p_status: status ?? null, p_limit: limit });
export const getAdminActivity = (limit = 80) => call<ActivityItem[]>("admin_activity", { p_limit: limit });
export const getAdminErrors = (hours = 168, includeResolved = false, limit = 50) =>
  call<ErrorGroup[]>("admin_errors", { p_hours: hours, p_include_resolved: includeResolved, p_limit: limit });

// ── Repairs ──────────────────────────────────────────────────────────────
// Each one writes an admin_actions row server-side, so the dashboard can't
// change anything without leaving a record of who changed it and from what.

/** Put a rating back: to a new player's numbers if no rated session survives,
 *  otherwise to the most recent snapshot whose session still exists. History
 *  rows left pointing at a deleted session are removed (copied into the
 *  admin_actions log first, so the change can be undone by hand). */
export const resetUserRating = (userId: string) =>
  call<{ mode: "defaults" | "from_history"; rating: number; games: number; orphans_removed: number }>(
    "admin_reset_user_rating",
    { p_user_id: userId },
  );

/** Point a session's player row at an account, or at nobody (pass null). */
export const linkPlayer = (playerId: string, userId: string | null) =>
  call<{ player_id: string; linked_user_id: string | null }>("admin_link_player", {
    p_player_id: playerId,
    p_user_id: userId,
  });

export const setAdmin = (userId: string, isAdmin: boolean) =>
  call<{ user_id: string; is_admin: boolean }>("admin_set_admin", { p_user_id: userId, p_is_admin: isAdmin });

export const resolveErrorGroup = (fingerprint: string, resolved = true) =>
  call<number>("admin_resolve_error", { p_fingerprint: fingerprint, p_resolved: resolved });


// ── 0043: sessions, live, search, growth, settings ───────────────────────

export interface SessionPlayer {
  id: string;
  display_name: string;
  gender: string | null;
  team_side: string | null;
  preferred_side: string | null;
  status: string;
  matches_played: number;
  rests: number;
  email: string | null;
  linked_user_id: string | null;
  account_name: string | null;
  account_email: string | null;
  /** False on a linked player used to mean their Player tab couldn't see this
   *  session. Fixed in 0049 — get_player_sessions now also matches a linked
   *  player row — so this is diagnostic history rather than a live problem. */
  has_join_request: boolean;
  /** True when this session has already moved that account's rating, i.e. a
   *  rating_history row exists for the pair. The Credit rating button is only
   *  offered when this is false. */
  rated_for_session: boolean;
}

export interface SessionMatch {
  id: string;
  court_label: string | null;
  court_ordinal: number | null;
  score_a: number | null;
  score_b: number | null;
  outcome: string | null;
  status: string;
  team_a: string | null;
  team_b: string | null;
}

export interface SessionDetail {
  session: {
    id: string;
    name: string;
    format: string;
    scoring_format: string;
    ranking_basis: string;
    status: string;
    join_code: string;
    public_token: string;
    fixed_partner_style: string | null;
    team_score_mode: string | null;
    counts_for_league: boolean | null;
    ratings_applied: boolean;
    results_applied: boolean;
    created_at: string;
    started_at: string | null;
    ended_at: string | null;
    created_by: string | null;
    host_name: string | null;
    host_email: string | null;
    club_id: string | null;
    club_name: string | null;
  } | null;
  players: SessionPlayer[];
  rounds: {
    id: string;
    sequence: number;
    status: string;
    generation_reason: string | null;
    generated_at: string | null;
    matches: SessionMatch[];
  }[];
  score_edits: {
    id: string;
    old_score_a: number | null;
    old_score_b: number | null;
    new_score_a: number | null;
    new_score_b: number | null;
    reason: string | null;
    edited_at: string;
    edited_by: string | null;
  }[];
  ratings: {
    user_id: string;
    display_name: string | null;
    rating: number;
    delta: number | null;
    rating_before: number | null;
    games_before: number | null;
    games_after: number | null;
    created_at: string;
  }[];
  league_rows: {
    user_id: string;
    display_name: string | null;
    rank: number;
    placement_points: number;
    podium_bonus: number;
    wins: number;
    losses: number;
    draws: number;
    perf_adj: number;
  }[];
  join_requests: {
    id: string;
    display_name: string;
    email: string | null;
    status: string;
    player_id: string | null;
    created_at: string;
    decided_at: string | null;
  }[];
  claims: {
    id: string;
    player_id: string;
    claimant_user_id: string | null;
    claimant: string | null;
    status: string;
    created_at: string;
    decided_at: string | null;
  }[];
}

export interface LiveSession {
  id: string;
  name: string;
  format: string;
  status: string;
  join_code: string;
  public_token: string;
  started_at: string | null;
  host_name: string | null;
  club_name: string | null;
  players: number;
  current_round: number | null;
  rounds: number;
  scored: number;
  unscored: number;
  /** Newest of: last score, last round generated, session start. How stale a
   *  live session is says more than that it is live. */
  last_activity: string;
}

export interface SearchHit {
  weight: number;
  type: "session" | "user" | "club" | "player";
  id: string;
  label: string;
  sublabel: string | null;
}

export interface Growth {
  weekly: { week: string; signups: number; sessions: number; active_hosts: number; active_players: number }[];
  funnel: {
    accounts: number;
    onboarded: number;
    played_ever: number;
    played_in_7d: number;
    played_twice: number;
    hosted_ever: number;
  };
  stalled: { id: string; display_name: string; email: string | null; created_at: string; onboarded: boolean }[];
}

export interface AppSettings {
  banner_message: string | null;
  banner_tone: "info" | "warn";
  banner_until: string | null;
  signups_paused: boolean;
  maintenance_message: string | null;
}

/** One row in the report queue (0054).
 *
 *  Carries the profile twice on purpose: as it was when someone complained,
 *  and as it is now. A difference between them is itself information — either
 *  the subject tidied up, or somebody already acted. */
export interface AdminReport {
  id: string;
  reason: string;
  detail: string | null;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  created_at: string;
  reviewed_at: string | null;
  admin_note: string | null;
  reporter_id: string | null;
  reporter_name: string | null;
  subject_user_id: string;
  snapshot_name: string | null;
  snapshot_avatar: string | null;
  snapshot_bio: string | null;
  current_name: string | null;
  current_avatar: string | null;
  current_bio: string | null;
  subject_deleted: boolean;
  /** How often this subject has been reported, and how often this reporter
   *  reports. A first complaint and a fifth are different situations, and
   *  reading them one at a time hides that. */
  reports_about_subject: number;
  reports_by_reporter: number;
  reviewed_by_name: string | null;
}

export const getAdminReports = (includeClosed = false) =>
  call<AdminReport[]>("admin_reports", { p_include_closed: includeClosed });

export const resolveReport = (reportId: string, status: AdminReport["status"], note?: string) =>
  call<void>("admin_resolve_report", {
    p_report_id: reportId,
    p_status: status,
    p_note: note?.trim() || null,
  });

/** The admin session page reads every list on this payload without a guard,
 *  so one missing key is a blank error screen rather than a smaller page —
 *  which is exactly what migration 0049 caused. Default the lists here so a
 *  server-side omission degrades into an empty section instead. */
export const getSessionDetail = async (sessionId: string): Promise<SessionDetail> => {
  const d = await call<SessionDetail>("admin_session_detail", { p_session_id: sessionId });
  return {
    ...d,
    players: d?.players ?? [],
    rounds: d?.rounds ?? [],
    score_edits: d?.score_edits ?? [],
    ratings: d?.ratings ?? [],
    league_rows: d?.league_rows ?? [],
    join_requests: d?.join_requests ?? [],
    claims: d?.claims ?? [],
  };
};
export const getLiveNow = () => call<LiveSession[]>("admin_live_now");
export const adminSearch = (query: string) => call<SearchHit[]>("admin_search", { p_query: query });

/** Credit one account for one ended session — the repair for a spot claimed
 *  too late. Refuses if that pair already has a rating_history row, so it can
 *  be retried safely. See migration 0047 and adminRatingRepair.ts. */
export const creditSessionRating = (
  sessionId: string,
  userId: string,
  c: { rating: number; rd: number; vol: number; games: number; delta: number },
) =>
  call<{ rating_before: number; rating_after: number; delta: number }>("admin_credit_session_rating", {
    p_session_id: sessionId,
    p_user_id: userId,
    p_rating: c.rating,
    p_rd: c.rd,
    p_vol: c.vol,
    p_games: c.games,
    p_delta: c.delta,
  });
export const getGrowth = () => call<Growth>("admin_growth");
export const getAdminAppSettings = () => call<AppSettings>("get_app_settings");

export const saveAppSettings = (s: {
  banner_message: string | null;
  banner_tone: "info" | "warn";
  banner_until: string | null;
  signups_paused: boolean;
  maintenance_message: string | null;
}) =>
  call<AppSettings>("admin_set_app_settings", {
    p_banner_message: s.banner_message,
    p_banner_tone: s.banner_tone,
    p_banner_until: s.banner_until,
    p_signups_paused: s.signups_paused,
    p_maintenance_message: s.maintenance_message,
  });

/** Move a stuck session to ended. Does NOT apply ratings — those are computed
 *  on the client from the final matches — so follow it with Re-run finalize if
 *  the session should count. */
export const forceEndSession = (sessionId: string) =>
  call<{ session_id: string; status: string; changed: boolean }>("admin_force_end_session", {
    p_session_id: sessionId,
  });
