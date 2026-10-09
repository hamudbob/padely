import { supabase } from "./client";
import { assembleStandings, StandingsInput } from "./standingsQueries";
import { RankingBasis } from "../scoring/standings";
import { HostSessionSummary } from "./hostSessionsQueries";
import { listAllLocalSessions } from "../offline/localSession";

/**
 * Home-screen data in ONE batched pass. listHostSessions gives the bare session
 * list; this additionally computes, for every session the host owns:
 *   - the host's finishing place (`myRank` of `fieldSize`) when the host played
 *     in it, and how many games they played there (`myGames`)
 *   - the field size (players/pairs ranked)
 * plus three account-level stats for the greeting strip.
 *
 * Efficiency: instead of N per-session fetches, this issues a fixed handful of
 * batched queries (`.in(sessionIds)` / `.in(roundIds)` / `.in(matchIds)`), then
 * groups in memory and runs the SAME assembleStandings() the Standings tab uses
 * — so a home "1st of 16" can never disagree with the session's own board.
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
    .select("id, name, format, status, join_code, created_at, ended_at, ranking_basis, fixed_partner_style, scoring_format")
    .eq("team_id", teamRow.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (sessionsError) throw sessionsError;

  const sessions = sessionRows ?? [];
  // Not EMPTY outright: a host whose very first session is running on this
  // phone, not yet uploaded, has no server rows at all — and Play showed
  // nothing while the session was live in their hand.
  if (sessions.length === 0) return withLocalSessions(EMPTY);

  // Placement/round enrichment (the expensive per-session standings computation)
  // is bounded to the live sessions plus the most recent ended ones, so this
  // landing-screen query can't grow without limit as a host's history piles up.
  // Older sessions still list — they just show no finishing-place medal (myRank
  // null, which the UI already renders as a neutral state). The proper unbounded
  // fix is snapshotting placement onto the session row at endSession() (needs a
  // small migration); this is the safe interim bound.
  const ENRICH_RECENT_ENDED = 25;
  const liveIds = sessions.filter((s) => s.status === "live").map((s) => s.id);
  const endedIds = sessions.filter((s) => s.status !== "live").map((s) => s.id).slice(0, ENRICH_RECENT_ENDED);
  const enrichIds = [...liveIds, ...endedIds];
  const enrichSet = new Set(enrichIds);

  if (enrichIds.length === 0) {
    // No sessions to enrich (shouldn't happen given the guard above), but keep
    // the shape correct.
    return {
      sessions: sessions.map((s) => ({
        id: s.id, name: s.name, format: s.format, status: s.status, joinCode: s.join_code,
        createdAt: s.created_at, endedAt: s.ended_at, playerCount: 0, roundCount: 0, fieldSize: 0, myRank: null, myGames: 0,
      })),
      stats: { sessionsHosted: sessions.length, activeThisMonth: 0, gamesPlayed: 0 },
    };
  }

  // Batched children — only for the enriched window. players / rounds /
  // adjustments / pairs keyed by session, then matches by round, then
  // participants by match. Flat regardless of how many sessions the host has.
  // 20 sessions per slice keeps a slice's players (~24 a night) and rounds
  // well under the 1000-row cap.
  type PlayerRow = { id: string; session_id: string; display_name: string; team_side: "A" | "B" | null; status: string; email: string | null; linked_user_id: string | null };
  const [players, rounds, adjustments, pairs] = await Promise.all([
    selectIn<PlayerRow>("players", "id, session_id, display_name, team_side, status, email, linked_user_id", "session_id", enrichIds, 20),
    selectIn<{ id: string; session_id: string }>("rounds", "id, session_id", "session_id", enrichIds, 20),
    selectIn<{ session_id: string; player_id: string | null; pair_id: string | null; amount: number }>(
      "adjustments", "session_id, player_id, pair_id, amount", "session_id", enrichIds, 20,
    ),
    selectIn<{ id: string; session_id: string; player_a_id: string; player_b_id: string }>(
      "pairs", "id, session_id, player_a_id, player_b_id", "session_id", enrichIds, 20,
    ),
  ]);

  const roundList = rounds ?? [];
  const roundToSession = new Map<string, string>(roundList.map((r) => [r.id, r.session_id]));
  const roundIds = roundList.map((r) => r.id);

  type MatchRow = { id: string; round_id: string; score_a: number | null; score_b: number | null; outcome: string | null; status: string };
  const matchRows = await selectIn<MatchRow>(
    "matches", "id, round_id, score_a, score_b, outcome, status", "round_id", roundIds, 100,
    (q) => q.eq("status", "final"),
  );
  const matchToSession = new Map<string, string>();
  for (const m of matchRows) {
    const sid = roundToSession.get(m.round_id);
    if (sid) matchToSession.set(m.id, sid);
  }
  const matchIds = matchRows.map((m) => m.id);

  // 100 matches x 4 seats = 400 rows a slice.
  const participantRows = await selectIn<{ match_id: string; player_id: string; side: "A" | "B" }>(
    "match_participants", "match_id, player_id, side", "match_id", matchIds, 100,
  );

  // Group every child collection by session id.
  const bySession = <T>(rows: T[], sid: (r: T) => string | undefined) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const k = sid(r);
      if (!k) continue;
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return map;
  };

  const roundsBySession = bySession(roundList, (r) => r.session_id);
  const playersBySession = bySession(players ?? [], (p) => p.session_id);
  const adjustmentsBySession = bySession(adjustments ?? [], (a) => a.session_id);
  const pairsBySession = bySession(pairs ?? [], (p) => p.session_id);
  const matchesBySession = bySession(matchRows, (m) => matchToSession.get(m.id));
  const participantsBySession = bySession(participantRows, (p) => matchToSession.get(p.match_id));

  const emailLc = user.email?.trim().toLowerCase() ?? null;

  const enriched: HostHomeSession[] = sessions.map((s) => {
    // Sessions outside the enrichment window list without a placement medal.
    if (!enrichSet.has(s.id)) {
      return {
        id: s.id, name: s.name, format: s.format, status: s.status, joinCode: s.join_code,
        createdAt: s.created_at, endedAt: s.ended_at, playerCount: 0, roundCount: 0, fieldSize: 0, myRank: null, myGames: 0,
      };
    }
    const sessionPlayers = playersBySession.get(s.id) ?? [];
    const sessionPairs = pairsBySession.get(s.id) ?? [];

    const standings = assembleStandings({
      session: {
        ranking_basis: s.ranking_basis as RankingBasis,
        format: s.format,
        fixed_partner_style: s.fixed_partner_style,
        scoring_format: s.scoring_format,
      },
      players: sessionPlayers.map((p) => ({ id: p.id, display_name: p.display_name, team_side: p.team_side, status: p.status })),
      finalMatches: (matchesBySession.get(s.id) ?? []) as StandingsInput["finalMatches"],
      participants: (participantsBySession.get(s.id) ?? []) as StandingsInput["participants"],
      adjustments: (adjustmentsBySession.get(s.id) ?? []) as StandingsInput["adjustments"],
      pairs: sessionPairs.map((p) => ({ id: p.id, player_a_id: p.player_a_id, player_b_id: p.player_b_id })),
    });

    // Which player row is the host? Prefer the account link, fall back to email.
    const hostPlayer =
      sessionPlayers.find((p) => p.linked_user_id === user.id) ??
      (emailLc ? sessionPlayers.find((p) => p.email?.trim().toLowerCase() === emailLc) : undefined);

    // Map the host's player id to the subject id the board ranks (self for most
    // formats; the containing pair for Fixed Partner).
    let hostSubjectId: string | null = null;
    if (hostPlayer) {
      const isFixedPartner = s.fixed_partner_style !== null || s.format === "fixed_partner";
      if (isFixedPartner) {
        const pair = sessionPairs.find((p) => p.player_a_id === hostPlayer.id || p.player_b_id === hostPlayer.id);
        hostSubjectId = pair?.id ?? null;
      } else {
        hostSubjectId = hostPlayer.id;
      }
    }

    const hostRow = hostSubjectId ? standings.rows.find((r) => r.subjectId === hostSubjectId) : undefined;

    return {
      id: s.id,
      name: s.name,
      format: s.format,
      status: s.status,
      joinCode: s.join_code,
      createdAt: s.created_at,
      endedAt: s.ended_at,
      playerCount: sessionPlayers.length,
      roundCount: (roundsBySession.get(s.id) ?? []).length,
      fieldSize: standings.rows.length,
      // Only show a place once the host actually played a game (a 0-game host
      // row would rank last on a tiebreak, which reads as misleading).
      myRank: hostRow && hostRow.matchesPlayed > 0 ? hostRow.rank : null,
      myGames: hostRow?.matchesPlayed ?? 0,
    };
  });

  // All-time games played by the host — accurate even for sessions outside the
  // enrichment window, via a cheap head-count of the host's own participant rows
  // (no standings computation needed).
  const allSessionIds = sessions.map((s) => s.id);
  let gamesPlayed = 0;
  const orFilter = emailLc ? `linked_user_id.eq.${user.id},email.eq.${emailLc}` : `linked_user_id.eq.${user.id}`;
  const { data: hostPlayerRows } = await supabase.from("players").select("id").in("session_id", allSessionIds).or(orFilter);
  const hostPlayerIds = (hostPlayerRows ?? []).map((r) => r.id);
  if (hostPlayerIds.length > 0) {
    const { count } = await supabase.from("match_participants").select("*", { count: "exact", head: true }).in("player_id", hostPlayerIds);
    gamesPlayed = count ?? 0;
  }

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
