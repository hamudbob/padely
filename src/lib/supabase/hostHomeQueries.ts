import { supabase } from "./client";
import { assembleStandings, StandingsInput } from "./standingsQueries";
import { RankingBasis } from "../scoring/standings";
import { HostSessionSummary } from "./hostSessionsQueries";

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

export async function getHostHomeSummary(): Promise<HostHomeSummary> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) return EMPTY;

  const { data: teamRow, error: teamError } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (teamError) throw teamError;
  if (!teamRow) return EMPTY;

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("sessions")
    .select("id, name, format, status, join_code, created_at, ended_at, ranking_basis, fixed_partner_style, scoring_format")
    .eq("team_id", teamRow.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (sessionsError) throw sessionsError;

  const sessions = sessionRows ?? [];
  if (sessions.length === 0) return EMPTY;

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
  const [
    { data: players, error: playersError },
    { data: rounds, error: roundsError },
    { data: adjustments, error: adjustmentsError },
    { data: pairs, error: pairsError },
  ] = await Promise.all([
    supabase.from("players").select("id, session_id, display_name, team_side, status, email, linked_user_id").in("session_id", enrichIds),
    supabase.from("rounds").select("id, session_id").in("session_id", enrichIds),
    supabase.from("adjustments").select("session_id, player_id, pair_id, amount").in("session_id", enrichIds),
    supabase.from("pairs").select("id, session_id, player_a_id, player_b_id").in("session_id", enrichIds),
  ]);
  if (playersError) throw playersError;
  if (roundsError) throw roundsError;
  if (adjustmentsError) throw adjustmentsError;
  if (pairsError) throw pairsError;

  const roundList = rounds ?? [];
  const roundToSession = new Map<string, string>(roundList.map((r) => [r.id, r.session_id]));
  const roundIds = roundList.map((r) => r.id);

  const finalMatches =
    roundIds.length > 0
      ? (
          await supabase
            .from("matches")
            .select("id, round_id, score_a, score_b, outcome, status")
            .in("round_id", roundIds)
            .eq("status", "final")
        )
      : { data: [], error: null };
  if (finalMatches.error) throw finalMatches.error;
  const matchRows = finalMatches.data ?? [];
  const matchToSession = new Map<string, string>();
  for (const m of matchRows) {
    const sid = roundToSession.get(m.round_id);
    if (sid) matchToSession.set(m.id, sid);
  }
  const matchIds = matchRows.map((m) => m.id);

  const participantsRes =
    matchIds.length > 0
      ? await supabase.from("match_participants").select("match_id, player_id, side").in("match_id", matchIds)
      : { data: [], error: null };
  if (participantsRes.error) throw participantsRes.error;
  const participantRows = participantsRes.data ?? [];

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

  return { sessions: enriched, stats };
}
