import { supabase } from "./client";
import { getLocalSession } from "../offline/localSession";

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
  /** Games this player has actually been on court for. Distinguishes someone
   *  who hasn't arrived from someone who played and went home — the same
   *  `left` status covers both, and the host needs to see which. */
  matchesPlayed: number;
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
  // A session started with no signal exists only on this phone until it
  // syncs. Everything below this point — the mapping, the pair labels, the
  // resting names — is identical either way; ONLY the source of the rows
  // changes. That is the whole design: the rules run once, on whichever rows
  // we have, so an offline session and a synced one can never disagree.
  // See lib/offline/localSession.ts.
  const local = getLocalSession(sessionId);
  const useLocal = Boolean(local && !local.syncedAt);

  let session: {
    id: string; name: string; format: string; scoring_format: string; join_code: string;
    public_token: string; status: string; team_score_mode: string | null;
    fixed_partner_style: string | null; ranking_basis: string;
  } | null = null;
  let courts: { id: string; display_name: string; available: boolean }[] = [];
  // gender and team_side are narrowed here rather than cast at the mapping:
  // the database CHECK constraints already guarantee these values, and the
  // local store is built from the same wizard types, so both sources really
  // do satisfy this.
  let players: { id: string; display_name: string; gender: "M" | "F"; status: string; team_side: "A" | "B" | null; matches_played: number }[] = [];
  let rounds: { id: string; sequence: number }[] = [];

  if (useLocal && local) {
    session = local.session;
    courts = local.courts.slice().sort((a, b) => a.ordinal - b.ordinal);
    players = local.players as typeof players;
    // Newest first, limit 1 — the same shape the query returns.
    rounds = local.rounds.slice().sort((a, b) => b.sequence - a.sequence).slice(0, 1);
  } else {
    const [
      { data: sessionData, error: sessionError },
      { data: courtsData, error: courtsError },
      { data: playersData, error: playersError },
      { data: roundsData, error: roundsError },
    ] = await Promise.all([
      supabase
        .from("sessions")
        .select("id, name, format, scoring_format, join_code, public_token, status, team_score_mode, fixed_partner_style, ranking_basis")
        .eq("id", sessionId)
        .single(),
      supabase.from("courts").select("id, display_name, available").eq("session_id", sessionId).order("ordinal", { ascending: true }),
      supabase.from("players").select("id, display_name, gender, status, team_side, matches_played").eq("session_id", sessionId),
      supabase.from("rounds").select("id, sequence").eq("session_id", sessionId).order("sequence", { ascending: false }).limit(1),
    ]);
    if (sessionError) throw sessionError;
    if (courtsError) throw courtsError;
    if (playersError) throw playersError;
    if (roundsError) throw roundsError;
    session = sessionData;
    courts = courtsData ?? [];
    players = (playersData ?? []) as typeof players;
    rounds = roundsData ?? [];
  }
  if (!session) throw new Error("Session not found.");

  const courtNameById = new Map(courts.map((c) => [c.id, c.display_name]));
  const playerNameById = new Map(players.map((p) => [p.id, p.display_name]));
  const round = rounds[0] ?? null;

  // Fixed Partner only — "FirstName & FirstName" per player, for the Players
  // tab's roster (see HostLiveRosterEntry.pairLabel). Cheap enough to fetch
  // unconditionally-guarded here rather than adding yet another parallel
  // batch stage.
  const isFixedPartner = session.fixed_partner_style !== null || session.format === "fixed_partner";
  const pairLabelByPlayerId = new Map<string, string>();
  if (isFixedPartner) {
    let pairs: { player_a_id: string; player_b_id: string }[] = [];
    if (useLocal && local) {
      pairs = local.pairs;
    } else {
      const { data, error: pairsError } = await supabase
        .from("pairs")
        .select("player_a_id, player_b_id")
        .eq("session_id", sessionId);
      if (pairsError) throw pairsError;
      pairs = data ?? [];
    }
    for (const p of pairs) {
      const nameA = playerNameById.get(p.player_a_id) ?? "?";
      const nameB = playerNameById.get(p.player_b_id) ?? "?";
      const label = `${nameA} & ${nameB}`;
      pairLabelByPlayerId.set(p.player_a_id, label);
      pairLabelByPlayerId.set(p.player_b_id, label);
    }
  }

  const roster: HostLiveRosterEntry[] = players.map((p) => ({
    id: p.id,
    name: p.display_name,
    gender: p.gender,
    status: p.status,
    teamSide: p.team_side,
    pairLabel: pairLabelByPlayerId.get(p.id) ?? null,
    matchesPlayed: p.matches_played ?? 0,
  }));

  const courtList: HostLiveCourt[] = courts.map((c) => ({ id: c.id, name: c.display_name, available: c.available }));

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
  let matchRows: { id: string; court_id: string; score_a: number | null; score_b: number | null; status: string }[] = [];
  let rests: { player_id: string }[] = [];
  let participants: { match_id: string; player_id: string; side: string }[] = [];

  if (useLocal && local) {
    matchRows = local.matches.filter((m) => m.round_id === round.id);
    rests = local.rests.filter((r) => r.round_id === round.id);
    const ids = new Set(matchRows.map((m) => m.id));
    participants = local.participants.filter((p) => ids.has(p.match_id));
  } else {
    const [
      { data: matchData, error: matchesError },
      { data: restData, error: restsError },
    ] = await Promise.all([
      supabase.from("matches").select("id, court_id, score_a, score_b, status").eq("round_id", round.id),
      supabase.from("round_rests").select("player_id").eq("round_id", round.id),
    ]);
    if (matchesError) throw matchesError;
    if (restsError) throw restsError;
    matchRows = matchData ?? [];
    rests = restData ?? [];

    const matchIds = matchRows.map((m) => m.id);
    const { data: participantData, error: participantsError } =
      matchIds.length > 0
        ? await supabase.from("match_participants").select("match_id, player_id, side").in("match_id", matchIds)
        : { data: [], error: null };
    if (participantsError) throw participantsError;
    participants = participantData ?? [];
  }

  const matches: HostLiveMatch[] = matchRows.map((m) => {
    const mine = participants.filter((p) => p.match_id === m.id);
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

  const restingIds = rests.map((r) => r.player_id);
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
