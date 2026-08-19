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

/** One other player, seen through your own results with (or against) them. */
export interface PeerStat {
  /** Stable identity: their account if they have one, else their name. */
  key: string;
  /** First name — what fits in a row. */
  label: string;
  fullName: string;
  /** Set when they have an account, so the row can open /u/<id>. */
  userId: string | null;
  avatarUrl: string | null;
  matches: number;
  /** YOUR wins in those matches — alongside them for a partner, against them
   *  for a rival. */
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  /** The ranking number: a Wilson lower bound, not the raw rate. */
  score: number;
}

/** A record over some window of time. */
export interface RecordSlice {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface Streak {
  kind: "W" | "L" | "D";
  count: number;
}

export interface PlayerInsights {
  sessionsPlayed: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // wins / matchesPlayed
  form: ("W" | "L" | "D")[]; // last 5 results, oldest → newest
  /** Every result, oldest → newest. The detail sheet shows the tail of it. */
  formAll: ("W" | "L" | "D")[];
  allTime: RecordSlice;
  last30: RecordSlice;
  /** The run you're on now, and the best and worst you've ever had. */
  currentStreak: Streak | null;
  bestWinStreak: number;
  worstLossStreak: number;
  /** Up to three each, ranked by confidence rather than raw rate. */
  topPartners: PeerStat[];
  topRivals: PeerStat[];
  /** Who you actually share a court with most — a different fact from who you
   *  win most with, and usually a more interesting one. */
  mostPlayedWith: PeerStat | null;
}

/**
 * Four games together before anyone is called your best partner or toughest
 * rival.
 *
 * It used to be two, ranked on raw win rate — so two-from-two beat
 * fifteen-from-twenty, and the person named was usually the person you had
 * played least. The bar and the ranking below fix the same bug from two
 * directions.
 */
const MIN_TOGETHER = 4;

/**
 * Wilson score lower bound — the ranking number for partners and rivals.
 *
 * The question isn't "what is your win rate with this person", it's "how sure
 * are we that it's high". This answers the second: the bottom of the 95%
 * confidence interval, so a small sample is pulled hard toward the middle and
 * a large one barely moves. 2 wins from 2 scores 0.342; 15 from 20 scores
 * 0.531; 4 from 4 scores 0.510 — so a perfect tiny sample sits below a strong
 * long one, which is the right way round and what a raw rate gets wrong.
 */
export function wilsonLower(wins: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = wins / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

const DAY_MS = 86_400_000;
const RECENT_DAYS = 30;

const EMPTY_SLICE: RecordSlice = {
  matches: 0, wins: 0, losses: 0, draws: 0, winRate: 0, pointsFor: 0, pointsAgainst: 0,
};

const EMPTY: PlayerInsights = {
  sessionsPlayed: 0,
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winRate: 0,
  form: [],
  formAll: [],
  allTime: EMPTY_SLICE,
  last30: EMPTY_SLICE,
  currentStreak: null,
  bestWinStreak: 0,
  worstLossStreak: 0,
  topPartners: [],
  topRivals: [],
  mostPlayedWith: null,
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
  matches: { id: string; round_id: string; outcome: string | null; status: string; score_a: number | null; score_b: number | null }[];
  participants: { match_id: string; player_id: string; side: "A" | "B" }[];
  rounds: { id: string; session_id: string; sequence: number }[];
  sessions: { id: string; created_at: string; ended_at: string | null; format: string | null }[];
  people: { id: string; display_name: string; linked_user_id: string | null; avatar_url: string | null }[];
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
  return computeInsights((raw ?? {}) as Partial<ParticipationPayload>);
}

/**
 * The maths, as a pure function of the RPC payload.
 *
 * Split out from the fetch on purpose: everything interesting here — the
 * chronology, the streak walk, the Wilson ranking — is arithmetic that can be
 * checked against a known payload without a network, a session or a browser.
 * The test does exactly that with rows dumped from a real database.
 */
export function computeInsights(payload: Partial<ParticipationPayload>): PlayerInsights {
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
  // Hosts type names in a hurry, so the same person arrives as "Dewi" in one
  // session and "dewi" in the next. They merge either way — the key is
  // lowercased — but the LABEL came from whichever row happened to be first,
  // which is how a profile ends up naming your best partner "dewi".
  const titled = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  const personOf = new Map(
    (payload.people ?? []).map((p) => {
      const full = p.display_name.trim();
      return [
        p.id,
        {
          key: p.linked_user_id ?? `name:${full.toLowerCase()}`,
          label: titled(full.split(/\s+/)[0]) || "Player",
          fullName: titled(full) || "Player",
          userId: p.linked_user_id,
          avatarUrl: p.avatar_url ?? null,
        },
      ];
    }),
  );

  // Participants grouped by match + side.
  const sidesByMatch = new Map<string, { A: string[]; B: string[] }>();
  for (const p of allParts) {
    const rec = sidesByMatch.get(p.match_id) ?? { A: [], B: [] };
    (p.side === "A" ? rec.A : rec.B).push(p.player_id);
    sidesByMatch.set(p.match_id, rec);
  }

  const scoreOf = new Map((payload.matches ?? []).map((m) => [m.id, { a: m.score_a, b: m.score_b }]));

  // When a match happened, for the 30-day split: the session's end, falling
  // back to its start for one that's still running.
  const sessionWhen = new Map(
    (payload.sessions ?? []).map((x) => [x.id, x.ended_at ?? x.created_at] as const),
  );

  interface Tally {
    label: string;
    fullName: string;
    userId: string | null;
    avatarUrl: string | null;
    w: number;
    l: number;
    d: number;
    n: number;
  }
  const blank = (p: { label: string; fullName: string; userId: string | null; avatarUrl: string | null }): Tally => ({
    label: p.label, fullName: p.fullName, userId: p.userId, avatarUrl: p.avatarUrl, w: 0, l: 0, d: 0, n: 0,
  });

  const partners = new Map<string, Tally>();
  const opponents = new Map<string, Tally>();
  const allTime = { ...EMPTY_SLICE };
  const last30 = { ...EMPTY_SLICE };
  const cutoff = Date.now() - RECENT_DAYS * DAY_MS;

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
    const result: "W" | "L" | "D" = isDraw ? "D" : won ? "W" : "L";
    formAll.push(result);

    // Points as they were actually played: my side's score against theirs.
    const sc = scoreOf.get(m.id);
    const mine = side === "A" ? sc?.a : sc?.b;
    const theirs = side === "A" ? sc?.b : sc?.a;

    const round = roundInfo.get(m.round_id);
    const whenIso = round ? sessionWhen.get(round.sessionId) : undefined;
    const recent = whenIso ? new Date(whenIso).getTime() >= cutoff : false;

    for (const slice of recent ? [allTime, last30] : [allTime]) {
      slice.matches++;
      if (result === "W") slice.wins++;
      else if (result === "L") slice.losses++;
      else slice.draws++;
      if (typeof mine === "number") slice.pointsFor += mine;
      if (typeof theirs === "number") slice.pointsAgainst += theirs;
    }

    const withMe = sides[side].filter((pid) => !myPlayerIds.includes(pid));
    const againstMe = side === "A" ? sides.B : sides.A;
    for (const [ids, book] of [
      [withMe, partners],
      [againstMe, opponents],
    ] as const) {
      for (const pid of ids) {
        const per = personOf.get(pid);
        if (!per) continue;
        const rec = book.get(per.key) ?? blank(per);
        rec.n++;
        if (result === "W") rec.w++;
        else if (result === "L") rec.l++;
        else rec.d++;
        book.set(per.key, rec);
      }
    }
  }

  const rate = (slice: RecordSlice) => (slice.matches > 0 ? slice.wins / slice.matches : 0);
  allTime.winRate = rate(allTime);
  last30.winRate = rate(last30);

  // Streaks, read off the same chronological list. A draw breaks a run of
  // either kind rather than extending it.
  let bestWinStreak = 0;
  let worstLossStreak = 0;
  let runKind: "W" | "L" | "D" | null = null;
  let runLength = 0;
  for (const r of formAll) {
    if (r === runKind) runLength++;
    else {
      runKind = r;
      runLength = 1;
    }
    if (r === "W") bestWinStreak = Math.max(bestWinStreak, runLength);
    if (r === "L") worstLossStreak = Math.max(worstLossStreak, runLength);
  }
  const currentStreak: Streak | null = runKind ? { kind: runKind, count: runLength } : null;

  const toPeer = (key: string, t: Tally, successes: number): PeerStat => ({
    key,
    label: t.label,
    fullName: t.fullName,
    userId: t.userId,
    avatarUrl: t.avatarUrl,
    matches: t.n,
    wins: t.w,
    losses: t.l,
    draws: t.d,
    winRate: t.n > 0 ? t.w / t.n : 0,
    score: wilsonLower(successes, t.n),
  });

  const qualified = (book: Map<string, Tally>) =>
    [...book.entries()].filter(([, t]) => t.n >= MIN_TOGETHER);

  // Best partners: ranked by how confident we are that YOU win alongside them.
  const topPartners = qualified(partners)
    .map(([k, t]) => toPeer(k, t, t.w))
    .sort((a, b) => b.score - a.score || b.matches - a.matches || a.label.localeCompare(b.label))
    .slice(0, 3);

  // Toughest rivals: the same maths with the outcome flipped — how confident
  // we are that THEY beat you. A rival you've played twice isn't a rival yet.
  const topRivals = qualified(opponents)
    .map(([k, t]) => toPeer(k, t, t.l))
    .sort((a, b) => b.score - a.score || b.matches - a.matches || a.label.localeCompare(b.label))
    .slice(0, 3);

  // Frequency, not chemistry: partner or opponent, whoever you've shared the
  // most matches with. No minimum — if you've only played once, that IS the
  // answer.
  const together = new Map<string, Tally>();
  for (const book of [partners, opponents]) {
    for (const [k, t] of book) {
      const rec = together.get(k) ?? { ...t, w: 0, l: 0, d: 0, n: 0 };
      rec.w += t.w;
      rec.l += t.l;
      rec.d += t.d;
      rec.n += t.n;
      together.set(k, rec);
    }
  }
  const mostPlayedWith =
    [...together.entries()]
      .map(([k, t]) => toPeer(k, t, t.w))
      .sort((a, b) => b.matches - a.matches || b.winRate - a.winRate || a.label.localeCompare(b.label))[0] ??
    null;

  return {
    sessionsPlayed: sessionIds.length,
    matchesPlayed: allTime.matches,
    wins: allTime.wins,
    losses: allTime.losses,
    draws: allTime.draws,
    winRate: allTime.winRate,
    form: formAll.slice(-5),
    formAll,
    allTime,
    last30,
    currentStreak,
    bestWinStreak,
    worstLossStreak,
    topPartners,
    topRivals,
    mostPlayedWith,
  };
}
