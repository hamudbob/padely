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

export async function getPlayerInsights(userId: string): Promise<PlayerInsights> {
  // Every player row that belongs to this account (one per session played).
  const { data: myPlayers, error: myErr } = await supabase
    .from("players")
    .select("id, session_id")
    .eq("linked_user_id", userId);
  if (myErr) throw myErr;
  const myPlayerIds = (myPlayers ?? []).map((p) => p.id);
  if (myPlayerIds.length === 0) return EMPTY;
  const sessionIds = [...new Set((myPlayers ?? []).map((p) => p.session_id))];

  // The matches I took part in (via my player rows).
  const { data: myParts, error: mpErr } = await supabase
    .from("match_participants")
    .select("match_id, player_id, side")
    .in("player_id", myPlayerIds);
  if (mpErr) throw mpErr;
  const mySideByMatch = new Map<string, "A" | "B">();
  for (const p of myParts ?? []) mySideByMatch.set(p.match_id, p.side);
  const matchIds = [...mySideByMatch.keys()];
  if (matchIds.length === 0) return { ...EMPTY, sessionsPlayed: sessionIds.length };

  // Those matches (final + decisive/draw only), all their participants, the
  // rounds (for chronology), and the sessions (for chronology).
  const [
    { data: matches, error: mErr },
    { data: allParts, error: apErr },
  ] = await Promise.all([
    supabase.from("matches").select("id, round_id, outcome, status").in("id", matchIds).eq("status", "final"),
    supabase.from("match_participants").select("match_id, player_id, side").in("match_id", matchIds),
  ]);
  if (mErr) throw mErr;
  if (apErr) throw apErr;

  const finalMatches = (matches ?? []).filter((m) => m.outcome && m.outcome !== "cancelled");
  if (finalMatches.length === 0) return { ...EMPTY, sessionsPlayed: sessionIds.length };

  // Chronology: order matches by session date then round sequence.
  const roundIds = [...new Set(finalMatches.map((m) => m.round_id))];
  const [{ data: rounds, error: rErr }, { data: sessions, error: sErr }] = await Promise.all([
    supabase.from("rounds").select("id, session_id, sequence").in("id", roundIds),
    supabase.from("sessions").select("id, created_at").in("id", sessionIds),
  ]);
  if (rErr) throw rErr;
  if (sErr) throw sErr;
  const roundInfo = new Map((rounds ?? []).map((r) => [r.id, { sessionId: r.session_id, sequence: r.sequence }]));
  const sessionAt = new Map((sessions ?? []).map((s) => [s.id, s.created_at]));

  // Names for partners/opponents; identity keyed by account (if any) else name.
  const involvedIds = [...new Set((allParts ?? []).map((p) => p.player_id))];
  const { data: playerRows, error: prErr } = await supabase
    .from("players")
    .select("id, display_name, linked_user_id")
    .in("id", involvedIds);
  if (prErr) throw prErr;
  const personOf = new Map(
    (playerRows ?? []).map((p) => [
      p.id,
      { key: p.linked_user_id ?? `name:${p.display_name.trim().toLowerCase()}`, label: p.display_name.trim().split(/\s+/)[0] || "Player" },
    ]),
  );

  // Participants grouped by match + side.
  const sidesByMatch = new Map<string, { A: string[]; B: string[] }>();
  for (const p of allParts ?? []) {
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
