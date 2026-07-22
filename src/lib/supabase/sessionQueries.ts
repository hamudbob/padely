import { supabase } from "./client";

export interface HostLiveMatch {
  id: string;
  courtName: string;
  teamANames: string[];
  teamBNames: string[];
  /** Real player ids alongside the display names above, for the Players tab's
   * per-player matches-played/rests counting — never shown directly. */
  teamAIds: string[];
  teamBIds: string[];
  scoreA: number | null;
  scoreB: number | null;
  status: string;
}

export interface HostLiveRosterEntry {
  id: string;
  name: string;
  gender: "M" | "F";
  status: string;
  /** Team Sparring only — null for every other format. */
  teamSide: "A" | "B" | null;
  /** Fixed Partner only — "FirstName & FirstName" of this player's locked partner. Null otherwise. */
  pairLabel: string | null;
}

export interface HostLiveCourt {
  id: string;
  name: string;
  available: boolean;
}

export interface HostLiveSnapshot {
  session: {
    id: string;
    name: string;
    format: string;
    scoringFormat: string;
    joinCode: string;
    publicToken: string;
    status: string;
    /** Team Sparring only — 'by_point' | 'by_win' | 'by_round'. Null for every other format. */
    teamScoreMode: string | null;
    /** Set only when partners are locked for the session — 'round_robin' | 'rank_based'. Null otherwise. */
    fixedPartnerStyle: string | null;
    /** 'points_first' | 'wins_first' — what Mexicano/Mix-Mexicano pairing ranks on, and the Standings rank badge. Switchable mid-session from Manage. */
    rankingBasis: string;
  };
  /** Every player in the session (regardless of round), for the Players tab. */
  roster: HostLiveRosterEntry[];
  /** Every court in the session (regardless of round), for the Manage menu. */
  courts: HostLiveCourt[];
  roundSequence: number | null;
  matches: HostLiveMatch[];
  restingNames: string[];
  /** Player ids resting this round, alongside restingNames above — same
   * "ids for aggregation, names for display" split as HostLiveMatch. */
  restingIds: string[];
}

/**
 * Read-only snapshot for the Host Live view — no score-entry mutation yet
 * (next build pass). Fires after every score save and tab switch, so its
 * round-trip count matters a lot for perceived lag: session/courts/players/
 * rounds are all independent of each other (none needs another's result),
 * so they run as ONE parallel batch instead of four sequential round trips.
 * Only matches (needs round.id) and participants (needs matchIds) are a
 * genuine dependency chain and stay sequential.
 */
export async function getHostLiveSnapshot(sessionId: string): Promise<HostLiveSnapshot> {
  const [
    { data: session, error: sessionError },
    { data: courts, error: courtsError },
    { data: players, error: playersError },
    { data: rounds, error: roundsError },
  ] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, name, format, scoring_format, join_code, public_token, status, team_score_mode, fixed_partner_style, ranking_basis")
      .eq("id", sessionId)
      .single(),
    supabase.from("courts").select("id, display_name, available").eq("session_id", sessionId).order("ordinal", { ascending: true }),
    supabase.from("players").select("id, display_name, gender, status, team_side").eq("session_id", sessionId),
    supabase.from("rounds").select("id, sequence").eq("session_id", sessionId).order("sequence", { ascending: false }).limit(1),
  ]);
  if (sessionError) throw sessionError;
  if (courtsError) throw courtsError;
  if (playersError) throw playersError;
  if (roundsError) throw roundsError;
  if (!session) throw new Error("Session not found.");

  const courtNameById = new Map((courts ?? []).map((c) => [c.id, c.display_name]));
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.display_name]));
  const round = rounds?.[0] ?? null;

  // Fixed Partner only — "FirstName & FirstName" per player, for the Players
  // tab's roster (see HostLiveRosterEntry.pairLabel). Cheap enough to fetch
  // unconditionally-guarded here rather than adding yet another parallel
  // batch stage.
  const isFixedPartner = session.fixed_partner_style !== null || session.format === "fixed_partner";
  const pairLabelByPlayerId = new Map<string, string>();
  if (isFixedPartner) {
    const { data: pairs, error: pairsError } = await supabase
      .from("pairs")
      .select("player_a_id, player_b_id")
      .eq("session_id", sessionId);
    if (pairsError) throw pairsError;
    for (const p of pairs ?? []) {
      const nameA = playerNameById.get(p.player_a_id) ?? "?";
      const nameB = playerNameById.get(p.player_b_id) ?? "?";
      const label = `${nameA} & ${nameB}`;
      pairLabelByPlayerId.set(p.player_a_id, label);
      pairLabelByPlayerId.set(p.player_b_id, label);
    }
  }

  const roster: HostLiveRosterEntry[] = (players ?? []).map((p) => ({
    id: p.id,
    name: p.display_name,
    gender: p.gender,
    status: p.status,
    teamSide: p.team_side,
    pairLabel: pairLabelByPlayerId.get(p.id) ?? null,
  }));

  const courtList: HostLiveCourt[] = (courts ?? []).map((c) => ({ id: c.id, name: c.display_name, available: c.available }));

  if (!round) {
    return {
      session: {
        id: session.id,
        name: session.name,
        format: session.format,
        scoringFormat: session.scoring_format,
        joinCode: session.join_code,
        publicToken: session.public_token,
        status: session.status,
        teamScoreMode: session.team_score_mode,
        fixedPartnerStyle: session.fixed_partner_style,
        rankingBasis: session.ranking_basis,
      },
      roster,
      courts: courtList,
      roundSequence: null,
      matches: [],
      restingNames: [],
      restingIds: [],
    };
  }

  // matches and rests both only depend on round.id (not on each other) —
  // fetch together.
  const [
    { data: matchRows, error: matchesError },
    { data: rests, error: restsError },
  ] = await Promise.all([
    supabase.from("matches").select("id, court_id, score_a, score_b, status").eq("round_id", round.id),
    supabase.from("round_rests").select("player_id").eq("round_id", round.id),
  ]);
  if (matchesError) throw matchesError;
  if (restsError) throw restsError;

  const matchIds = (matchRows ?? []).map((m) => m.id);
  const { data: participants, error: participantsError } =
    matchIds.length > 0
      ? await supabase.from("match_participants").select("match_id, player_id, side").in("match_id", matchIds)
      : { data: [], error: null };
  if (participantsError) throw participantsError;

  const matches: HostLiveMatch[] = (matchRows ?? []).map((m) => {
    const mine = (participants ?? []).filter((p) => p.match_id === m.id);
    const teamA = mine.filter((p) => p.side === "A");
    const teamB = mine.filter((p) => p.side === "B");
    return {
      id: m.id,
      courtName: courtNameById.get(m.court_id) ?? "Court",
      teamANames: teamA.map((p) => playerNameById.get(p.player_id) ?? "?"),
      teamBNames: teamB.map((p) => playerNameById.get(p.player_id) ?? "?"),
      teamAIds: teamA.map((p) => p.player_id),
      teamBIds: teamB.map((p) => p.player_id),
      scoreA: m.score_a,
      scoreB: m.score_b,
      status: m.status,
    };
  });

  const restingIds = (rests ?? []).map((r) => r.player_id);
  const restingNames = restingIds.map((id) => playerNameById.get(id) ?? "?");

  return {
    session: {
      id: session.id,
      name: session.name,
      format: session.format,
      scoringFormat: session.scoring_format,
      joinCode: session.join_code,
      publicToken: session.public_token,
      status: session.status,
      teamScoreMode: session.team_score_mode,
      fixedPartnerStyle: session.fixed_partner_style,
      rankingBasis: session.ranking_basis,
    },
    roster,
    courts: courtList,
    roundSequence: round.sequence,
    matches,
    restingNames,
    restingIds,
  };
}
