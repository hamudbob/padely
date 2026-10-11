import { supabase } from "./client";
import { HostSessionSummary } from "./hostSessionsQueries";
import { listAllLocalSessions } from "../offline/localSession";

/**
 * The Play tab's session list: every session the host owns, newest first,
 * plus round and player counts for the ones that are live.
 *
 * Deliberately light. It used to compute every recent session's standings to
 * show the host's finishing place beside each row, which was most of the
 * time the screen took to load (dropped 9 Oct 2026). myRank / myGames /
 * fieldSize are kept on the type, always null / 0, so the screen and anything
 * reading this keep compiling; they can go once nothing references them.
 */

export interface HostHomeSession extends HostSessionSummary {
  /** Players in the session (roster size). */
  playerCount: number;
  /** Rounds generated so far (for the live card's "Round N"). */
  roundCount: number;
  /** Subjects ranked on the board — players, or pairs for Fixed Partner. */
  fieldSize: number;
  /** Host's finishing place, or null if the host wasn't a player in this one. */
  myRank: number | null;
  /** Matches the host played in this session (0 if they didn't play). */
  myGames: number;
}

export interface HostHomeStats {
  sessionsHosted: number;
  /** Sessions created in the current calendar month. */
  activeThisMonth: number;
  /** Total matches the host played across every session (as a player). */
  gamesPlayed: number;
}

export interface HostHomeSummary {
  sessions: HostHomeSession[];
  stats: HostHomeStats;
}

const EMPTY: HostHomeSummary = {
  sessions: [],
  stats: { sessionsHosted: 0, activeThisMonth: 0, gamesPlayed: 0 },
};

/**
 * `.in(column, ids)` in slices, merged.
 *
 * Two hard limits sit under this screen, and a host with two months of
 * history crosses both. PostgREST returns at most 1000 rows per request and
 * says nothing when it stops — 25 sessions x ~22 matches x 4 players is ~2200
 * participant rows, so finishing places quietly came from half the data. And
 * every id goes into the URL: 550 match ids is ~20 KB of query string, long
 * enough to risk the gateway refusing it — and if any one request fails the
 * WHOLE home query fails, so Play falls back to the last cached list, which
 * does not have the session started tonight.
 *
 * Slices keep each request well under both. They run in parallel, so it costs
 * no extra wall-clock time in the common case.
 */
async function selectIn<T>(
  table: string,
  columns: string,
  column: string,
  ids: string[],
  size: number,
  narrow?: (q: any) => any,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += size) slices.push(ids.slice(i, i + size));
  const pages = await Promise.all(
    slices.map(async (slice) => {
      let q: any = (supabase as any).from(table).select(columns).in(column, slice);
      if (narrow) q = narrow(q);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as T[];
    }),
  );
  return pages.flat();
}

export async function getHostHomeSummary(): Promise<HostHomeSummary> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) return EMPTY;

  // limit(1), not maybeSingle(): maybeSingle ERRORS when a second row exists,
  // and for one account it did — two teams rows left by a check-then-insert
  // race, which broke this screen permanently on every device. 0044 dedupes
  // and adds the unique index; this reads the oldest row either way, so the
  // screen survives data it didn't expect.
  const { data: teamRows, error: teamError } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (teamError) throw teamError;
  const teamRow = (teamRows ?? [])[0];
  if (!teamRow) return withLocalSessions(EMPTY);

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("sessions")
    .select("id, name, format, status, join_code, created_at, ended_at")
    .eq("team_id", teamRow.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (sessionsError) throw sessionsError;

  const sessions = sessionRows ?? [];
  // Not EMPTY outright: a host whose very first session is running on this
  // phone, not yet uploaded, has no server rows at all — and Play showed
  // nothing while the session was live in their hand.
  if (sessions.length === 0) return withLocalSessions(EMPTY);

  // ONLY the live sessions need anything beyond the session row: their card
  // shows the round number and the player count. Past sessions are listed as
  // they are.
  //
  // This used to compute every past session's standings — up to 25 of them,
  // six batched queries and a full assembleStandings each — just to print the
  // host's finishing place ("2nd of 12") beside each row. It was most of the
  // time this screen took to load, and it ran on every open. Dropped on
  // purpose (9 Oct 2026); the place is one tap away on the session itself.
  const liveIds = sessions.filter((s) => s.status === "live").map((s) => s.id);
  const [livePlayers, liveRounds] = await Promise.all([
    selectIn<{ session_id: string }>("players", "session_id", "session_id", liveIds, 20),
    selectIn<{ session_id: string }>("rounds", "session_id", "session_id", liveIds, 20),
  ]);
  const countBy = (rows: { session_id: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.session_id, (m.get(r.session_id) ?? 0) + 1);
    return m;
  };
  const playersPer = countBy(livePlayers);
  const roundsPer = countBy(liveRounds);

  const enriched: HostHomeSession[] = sessions.map((s) => ({
    id: s.id,
    name: s.name,
    format: s.format,
    status: s.status,
    joinCode: s.join_code,
    createdAt: s.created_at,
    endedAt: s.ended_at,
    playerCount: playersPer.get(s.id) ?? 0,
    roundCount: roundsPer.get(s.id) ?? 0,
    fieldSize: 0,
    myRank: null,
    myGames: 0,
  }));

  // gamesPlayed is no longer computed here: nothing displays it, and it cost
  // two more queries with every session id in the URL.
  const gamesPlayed = 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const stats: HostHomeStats = {
    sessionsHosted: sessions.length,
    activeThisMonth: sessions.filter((s) => new Date(s.created_at).getTime() >= monthStart).length,
    gamesPlayed,
  };

  return withLocalSessions({ sessions: enriched, stats });
}

/**
 * Sessions this device holds that the server has not answered with — a
 * session started or ended with no signal. Without this, ending a session on
 * a court made it VANISH: gone from the live screen, absent from Play, and
 * only reappearing once it uploaded. The evening looked deleted.
 *
 * Merged rather than replaced, and only where the id is missing, so a synced
 * session is always represented by the server's richer row. Applied on EVERY
 * return path — it used to run only after the server list was non-empty.
 */
function withLocalSessions(summary: HostHomeSummary): HostHomeSummary {
  const seen = new Set(summary.sessions.map((s) => s.id));
  const localOnly = listAllLocalSessions()
    .filter((l) => !seen.has(l.session.id))
    .map((l) => ({
      id: l.session.id,
      name: l.session.name,
      format: l.session.format,
      status: l.session.status,
      created_at: l.session.created_at,
      started_at: l.session.started_at,
      ended_at: l.session.ended_at,
      public_token: l.session.public_token,
      join_code: l.session.join_code,
      playerCount: l.players.length,
      roundCount: l.rounds.length,
      fieldSize: l.players.length,
      myRank: null,
      myGames: 0,
    })) as unknown as HostHomeSession[];
  return { sessions: [...summary.sessions, ...localOnly], stats: summary.stats };
}
