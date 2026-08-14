import { supabase } from "./client";

/**
 * Player insights — aggregated across every session a signed-in user has played
 * (matched by players.linked_user_id). Computed on demand for now; a later
 * increment can cache these into profiles.stats at session end. Bounded by one
 * person's own history, so a handful of batched queries is fine.
 */

export interface RatingPoint {
  rating: number;
  delta: number;
  createdAt: string;
}

export interface PairStat {
  label: string;
  matches: number;
  wins: number;
  winRate: number;
}

export interface PlayerInsights {
  sessionsPlayed: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // wins / matchesPlayed
  bestPartner: PairStat | null; // highest win-rate teammate (min games)
  nemesis: PairStat | null; // opponent you beat least often (min games)
  form: ("W" | "L" | "D")[]; // last 5 results, oldest → newest
}

const MIN_TOGETHER = 2; // min shared matches before a partner/nemesis qualifies

const EMPTY: PlayerInsights = {
  sessionsPlayed: 0,
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winRate: 0,
  bestPartner: null,
  nemesis: null,
  form: [],
};

/** The rating-over-time series for the profile trend / sparkline. */
export async function getRatingHistory(userId: string): Promise<RatingPoint[]> {
  const { data, error } = await supabase
    .from("rating_history")
    .select("rating, delta, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ rating: r.rating, delta: r.delta, createdAt: r.created_at }));
}

/** The rows behind a record, as returned by get_my_participation (0039). */
interface ParticipationPayload {
  my_players: { id: string; session_id: string }[];
  my_participations: { match_id: string; player_id: string; side: "A" | "B" }[];
  matches: { id: string; round_id: string; outcome: string | null; status: string }[];
  participants: { match_id: string; player_id: string; side: "A" | "B" }[];
  rounds: { id: string; session_id: string; sequence: number }[];
  sessions: { id: string; created_at: string }[];
  people: { id: string; display_name: string; linked_user_id: string | null }[];
}

/**
 * The caller's own record: W/L/D, form, best partner, toughest rival.
 *
 * Reads through the get_my_participation RPC rather than the tables. It used to
 * query `players`, `match_participants`, `matches` and `rounds` directly, and
 * every policy on those is host-scoped — so for anyone who PLAYED a session
 * rather than hosting it, the first query came back empty and this returned
 * EMPTY. The symptom was a You tab claiming "play a session and your record
 * shows up here", with Played 0 and Games 0, directly beneath a rating strip
 * showing a real rating and a real game count (profiles is world-readable, and
 * the host's apply_session_ratings had already written it).
 *
 * `userId` is kept in the signature for call-site clarity, but the RPC scopes to
 * auth.uid() itself — a client can't ask for someone else's record.
 */
export async function getPlayerInsights(userId: string): Promise<PlayerInsights> {
  void userId;
  const { data: raw, error: rpcError } = await supabase.rpc("get_my_participation");
  if (rpcError) throw rpcError;
  const payload = (raw ?? {}) as Partial<ParticipationPayload>;

  const myPlayers = payload.my_players ?? [];
  const myPlayerIds = myPlayers.map((p) => p.id);
  if (myPlayerIds.length === 0) return EMPTY;
  const sessionIds = [...new Set(myPlayers.map((p) => p.session_id))];

  const mySideByMatch = new Map<string, "A" | "B">();
  for (const p of payload.my_participations ?? []) mySideByMatch.set(p.match_id, p.side);
  if (mySideByMatch.size === 0) return { ...EMPTY, sessionsPlayed: sessionIds.length };

  const allParts = payload.participants ?? [];
  const finalMatches = (payload.matches ?? []).filter(
    (m) => m.status === "final" && m.outcome && m.outcome !== "cancelled",
  );
  if (finalMatches.length === 0) return { ...EMPTY, sessionsPlayed: sessionIds.length };

  const roundInfo = new Map((payload.rounds ?? []).map((r) => [r.id, { sessionId: r.session_id, sequence: r.sequence }]));
  const sessionAt = new Map((payload.sessions ?? []).map((s) => [s.id, s.created_at]));

  // Identity keyed by account where there is one, else by name — so the same
  // person merges across sessions whether or not they'd signed up yet.
  const personOf = new Map(
    (payload.people ?? []).map((p) => [
      p.id,
      { key: p.linked_user_id ?? `name:${p.display_name.trim().toLowerCase()}`, label: p.display_name.trim().split(/\s+/)[0] || "Player" },
    ]),
  );

  // Participants grouped by match + side.
  const sidesByMatch = new Map<string, { A: string[]; B: string[] }>();
  for (const p of allParts) {
    const rec = sidesByMatch.get(p.match_id) ?? { A: [], B: [] };
    (p.side === "A" ? rec.A : rec.B).push(p.player_id);
    sidesByMatch.set(p.match_id, rec);
  }

  let wins = 0;
  let losses = 0;
  let draws = 0;
  const partners = new Map<string, { label: string; w: number; n: number }>();
  const opponents = new Map<string, { label: string; w: number; n: number }>();

  const chron = [...finalMatches].sort((a, b) => {
    const ra = roundInfo.get(a.round_id);
    const rb = roundInfo.get(b.round_id);
    const ta = ra ? sessionAt.get(ra.sessionId) ?? "" : "";
    const tb = rb ? sessionAt.get(rb.sessionId) ?? "" : "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (ra?.sequence ?? 0) - (rb?.sequence ?? 0);
  });

  const formAll: ("W" | "L" | "D")[] = [];
  for (const m of chron) {
    const side = mySideByMatch.get(m.id);
    if (!side) continue;
    const sides = sidesByMatch.get(m.id);
    if (!sides) continue;
    const won = (m.outcome === "win_a" && side === "A") || (m.outcome === "win_b" && side === "B");
    const isDraw = m.outcome === "draw";
    if (isDraw) draws++;
    else if (won) wins++;
    else losses++;
    formAll.push(isDraw ? "D" : won ? "W" : "L");

    const mine = sides[side].filter((pid) => !myPlayerIds.includes(pid));
    const theirs = side === "A" ? sides.B : sides.A;
    for (const pid of mine) {
      const per = personOf.get(pid);
      if (!per) continue;
      const rec = partners.get(per.key) ?? { label: per.label, w: 0, n: 0 };
      rec.n++;
      if (won) rec.w++;
      partners.set(per.key, rec);
    }
    for (const pid of theirs) {
      const per = personOf.get(pid);
      if (!per) continue;
      const rec = opponents.get(per.key) ?? { label: per.label, w: 0, n: 0 };
      rec.n++;
      if (won) rec.w++; // my wins against them
      opponents.set(per.key, rec);
    }
  }

  const matchesPlayed = wins + losses + draws;
  const eligible = (m: Map<string, { label: string; w: number; n: number }>) =>
    [...m.values()].filter((r) => r.n >= MIN_TOGETHER);
  const bestPartner = eligible(partners).sort((a, b) => b.w / b.n - a.w / a.n || b.n - a.n)[0] ?? null;
  const nemesis = eligible(opponents).sort((a, b) => a.w / a.n - b.w / b.n || b.n - a.n)[0] ?? null;

  return {
    sessionsPlayed: sessionIds.length,
    matchesPlayed,
    wins,
    losses,
    draws,
    winRate: matchesPlayed > 0 ? wins / matchesPlayed : 0,
    bestPartner: bestPartner ? { label: bestPartner.label, matches: bestPartner.n, wins: bestPartner.w, winRate: bestPartner.w / bestPartner.n } : null,
    nemesis: nemesis ? { label: nemesis.label, matches: nemesis.n, wins: nemesis.w, winRate: nemesis.w / nemesis.n } : null,
    form: formAll.slice(-5),
  };
}
