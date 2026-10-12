import type { LocalSession, LocalMatchRow, LocalRoundRow } from "./localSession";
import { recountMatchesPlayed } from "./localSession";

/**
 * Co-hosts, from the host phone's side.
 *
 * The host's phone holds the session and pushes it up. A co-host writes to the
 * server directly (0065/0071). So the phone has to PULL that work back in, or
 * it would sit on a stale copy: rounds the co-host scored showing as unplayed,
 * Next Round refusing, and the standings wrong.
 *
 * This file is the pure half: given the phone's copy and the server's
 * (get_scorer_session), fold one into the other. No network, no storage, so
 * every rule here is tested directly (__tests__/coHostMerge.test.ts).
 *
 * The rules mirror what 0071 enforces on the server, so the two copies
 * converge instead of trading values back and forth:
 *
 *  - SCORES: the later-entered score wins. A match the phone has not scored
 *    takes the server's score. A match both have scored takes the server's
 *    only if the server's was entered LATER (scored_at). A server score with
 *    no timestamp never replaces one the phone has.
 *
 *  - ROUNDS: a round drawn elsewhere (a co-host, or the host on another
 *    device) past the phone's last round is added, with its matches, lineups
 *    and rests. Never one the host deleted on purpose (discardedRoundIds).
 *    At a sequence the phone already has, the phone's own round wins — unless
 *    the server's has been PLAYED and the phone's hasn't: then the phone drew
 *    its round while behind, and the server (0076) has already refused it.
 *
 *  - PLAYERS the phone has never seen (added on another device) are added.
 *
 *  - Nothing else. Courts, settings and player statuses stay the phone's.
 */

/* ── What get_scorer_session returns (0071) ─────────────────────────────── */

export interface ScorerSession {
  session: {
    id: string;
    name: string;
    format: string;
    scoring_format: string;
    ranking_basis: string;
    fixed_partner_style: string | null;
    team_score_mode: string | null;
    min_players_per_court: number;
    scheduling_seed: number;
    status: "draft" | "live" | "ended";
    club_id: string | null;
    started_at: string | null;
    host_name: string | null;
    is_host: boolean;
  };
  courts: { id: string; ordinal: number; display_name: string; available: boolean }[];
  players: {
    id: string;
    display_name: string;
    gender: string;
    status: "active" | "late" | "left";
    team_side: string | null;
    preferred_side: string | null;
    matches_played: number;
    rests: number;
    joined_at: string;
    linked_user_id: string | null;
    avatar_url: string | null;
  }[];
  pairs: { id: string; label: string; team_side: string | null; player_a_id: string; player_b_id: string }[];
  rounds: {
    id: string;
    sequence: number;
    status: LocalRoundRow["status"];
    generation_reason: string;
    seed_used: number;
    generated_at: string;
    added_by_scorer: string | null;
  }[];
  round_rests: { round_id: string; player_id: string; consecutive_rest_count: number }[];
  adjustments: { player_id: string | null; pair_id: string | null; amount: number }[];
  matches: {
    id: string;
    round_id: string;
    court_id: string;
    pair_a_id: string | null;
    pair_b_id: string | null;
    status: LocalMatchRow["status"];
    outcome: string | null;
    score_a: number | null;
    score_b: number | null;
    scored_at: string | null;
    participants: { player_id: string; side: "A" | "B" }[];
  }[];
}

export interface MergeReport {
  /** Scores taken from the server. */
  scores: number;
  /** Rounds taken from the server. */
  rounds: number;
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Should the server's score replace the phone's? */
export function serverScoreWins(local: LocalMatchRow, server: ScorerSession["matches"][number]): boolean {
  if (server.status !== "final" || server.score_a === null || server.score_b === null) return false;
  if (local.status === "cancelled") return false;
  if (local.status !== "final" || local.score_a === null || local.score_b === null) return true;
  if (local.score_a === server.score_a && local.score_b === server.score_b) return false;
  const s = time(server.scored_at);
  if (s === null) return false;
  const l = time(local.scored_at);
  return l === null || s > l;
}

/** Mutates `local`. Returns what it took, so the caller knows to redraw. */
export function mergeScorerState(local: LocalSession, server: ScorerSession): MergeReport {
  const report: MergeReport = { scores: 0, rounds: 0 };
  if (server.session.id !== local.session.id) return report;

  const touchedRounds = new Set<string>();

  // ── Scores ────────────────────────────────────────────────────────────
  const localMatch = new Map(local.matches.map((m) => [m.id, m]));
  for (const sm of server.matches) {
    const lm = localMatch.get(sm.id);
    if (!lm || !serverScoreWins(lm, sm)) continue;
    lm.score_a = sm.score_a;
    lm.score_b = sm.score_b;
    lm.outcome = sm.outcome;
    lm.status = "final";
    lm.scored_at = sm.scored_at ?? lm.scored_at ?? null;
    touchedRounds.add(lm.round_id);
    report.scores++;
  }

  // ── Players added somewhere else ──────────────────────────────────────
  // Only the host adds players, but the host may have done it on another
  // device. A live session never hard-deletes a player (leaving is a status),
  // so one the phone lacks is new, not one it removed. Without this a round
  // pulled below could seat someone this phone has never heard of.
  for (const p of server.players) {
    if (local.players.some((l) => l.id === p.id)) continue;
    local.players.push({
      id: p.id,
      session_id: local.session.id,
      display_name: p.display_name,
      gender: p.gender,
      linked_user_id: p.linked_user_id,
      team_side: p.team_side,
      preferred_side: p.preferred_side,
      status: p.status,
      matches_played: p.matches_played,
      rests: p.rests,
      joined_at: p.joined_at,
    });
  }

  // ── Rounds drawn somewhere else ───────────────────────────────────────
  // By a co-host, or by the host on another device (12 Oct 2026: a night
  // run on the web while the phone's copy sat on round 1).
  const discarded = new Set(local.discardedRoundIds ?? []);
  const played = (roundId: string, ms: { round_id: string; status: string }[]) =>
    ms.some((m) => m.round_id === roundId && m.status === "final");

  const incoming = server.rounds
    .filter((r) => !local.rounds.some((l) => l.id === r.id) && !discarded.has(r.id))
    .sort((a, b) => a.sequence - b.sequence);

  for (const r of incoming) {
    const matches = server.matches.filter((m) => m.round_id === r.id);
    if (matches.length === 0) continue;

    const mine = local.rounds.find((l) => l.sequence === r.sequence);
    if (mine) {
      // Two rounds with the same number. The server's wins only if it has
      // been PLAYED and this phone's hasn't: then this phone drew its round
      // while behind, and 0076 already refused it. Otherwise this phone's
      // own round stands, as it does on the server.
      if (!played(r.id, server.matches) || played(mine.id, local.matches)) continue;
      const gone = new Set(local.matches.filter((m) => m.round_id === mine.id).map((m) => m.id));
      local.matches = local.matches.filter((m) => m.round_id !== mine.id);
      local.participants = local.participants.filter((p) => !gone.has(p.match_id));
      local.rests = local.rests.filter((x) => x.round_id !== mine.id);
      local.rounds = local.rounds.filter((l) => l.id !== mine.id);
    } else {
      // Only a run that continues the phone's own: 4, 5 after 3 — never 5
      // after 3 with 4 missing, which would leave a hole the scheduler reads
      // as a round nobody played.
      const lastSeq = local.rounds.reduce((max, l) => Math.max(max, l.sequence), 0);
      if (r.sequence !== lastSeq + 1) continue;
    }

    local.rounds.push({
      id: r.id,
      session_id: local.session.id,
      sequence: r.sequence,
      status: r.status,
      generation_reason: r.generation_reason,
      seed_used: r.seed_used,
      generated_at: r.generated_at,
    });
    for (const m of matches) {
      local.matches.push({
        id: m.id,
        round_id: r.id,
        court_id: m.court_id,
        pair_a_id: m.pair_a_id,
        pair_b_id: m.pair_b_id,
        score_a: m.score_a,
        score_b: m.score_b,
        outcome: m.outcome,
        status: m.status,
        scored_at: m.scored_at,
      });
      for (const p of m.participants) {
        local.participants.push({ match_id: m.id, player_id: p.player_id, side: p.side });
      }
    }
    for (const rr of server.round_rests) {
      if (rr.round_id !== r.id) continue;
      local.rests.push({ round_id: r.id, player_id: rr.player_id, consecutive_rest_count: rr.consecutive_rest_count });
    }
    touchedRounds.add(r.id);
    report.rounds++;
  }

  if (report.scores === 0 && report.rounds === 0) return report;

  // ── Round status, exactly as the phone keeps it ───────────────────────
  // setLocalMatchScore: scored once every match is final. And any round with
  // a newer one after it is finished by definition — generateNextRound marks
  // it so when the host advances, and the co-host advancing is the same act.
  for (const round of local.rounds) {
    if (!touchedRounds.has(round.id) || round.status === "superseded") continue;
    const ms = local.matches.filter((m) => m.round_id === round.id);
    if (ms.length > 0) round.status = ms.every((m) => m.status === "final") ? "scored" : "in_progress";
  }
  if (report.rounds > 0) {
    const ordered = local.rounds.slice().sort((x, y) => x.sequence - y.sequence);
    for (const round of ordered.slice(0, -1)) {
      if (round.status !== "superseded") round.status = "scored";
    }
  }

  recountMatchesPlayed(local);
  return report;
}

/**
 * The co-host's own working copy: the server's graph in the phone's shape,
 * so the co-host draws the next round through the very same
 * generateNextRound the host uses. Never stored on the co-host's phone.
 */
export function graphFromScorerSession(server: ScorerSession): LocalSession {
  const sid = server.session.id;
  return {
    session: {
      id: sid,
      club_id: server.session.club_id,
      name: server.session.name,
      format: server.session.format,
      scoring_format: server.session.scoring_format,
      ranking_basis: server.session.ranking_basis,
      status: server.session.status === "ended" ? "ended" : "live",
      join_code: "",
      public_token: "",
      scheduling_seed: Number(server.session.scheduling_seed),
      min_players_per_court: server.session.min_players_per_court,
      team_score_mode: server.session.team_score_mode,
      fixed_partner_style: server.session.fixed_partner_style,
      counts_for_league: true,
      created_at: server.session.started_at ?? "",
      started_at: server.session.started_at ?? "",
      ended_at: null,
    },
    courts: server.courts.map((c) => ({ ...c, session_id: sid })),
    players: server.players.map((p) => ({
      id: p.id,
      session_id: sid,
      display_name: p.display_name,
      gender: p.gender,
      linked_user_id: p.linked_user_id,
      team_side: p.team_side,
      preferred_side: p.preferred_side,
      status: p.status,
      matches_played: p.matches_played,
      rests: p.rests,
      joined_at: p.joined_at,
    })),
    pairs: server.pairs.map((p) => ({ ...p, session_id: sid, is_auto_label: true })),
    rounds: server.rounds.map((r) => ({
      id: r.id,
      session_id: sid,
      sequence: r.sequence,
      status: r.status,
      generation_reason: r.generation_reason,
      seed_used: Number(r.seed_used),
      generated_at: r.generated_at,
    })),
    matches: server.matches.map((m) => ({
      id: m.id,
      round_id: m.round_id,
      court_id: m.court_id,
      pair_a_id: m.pair_a_id,
      pair_b_id: m.pair_b_id,
      score_a: m.score_a,
      score_b: m.score_b,
      outcome: m.outcome,
      status: m.status,
      scored_at: m.scored_at,
    })),
    participants: server.matches.flatMap((m) =>
      m.participants.map((p) => ({ match_id: m.id, player_id: p.player_id, side: p.side })),
    ),
    rests: server.round_rests.map((r) => ({ ...r })),
    syncedAt: null,
    lastReplicatedAt: null,
    lastError: null,
  };
}

/**
 * The round generateNextRound just added to a graph, in the shape
 * append_round_as_scorer takes.
 */
export function appendPayload(graph: LocalSession, roundId: string): Record<string, unknown> {
  const round = graph.rounds.find((r) => r.id === roundId);
  if (!round) throw new Error("The new round was not drawn.");
  const matches = graph.matches.filter((m) => m.round_id === roundId);
  return {
    id: round.id,
    sequence: round.sequence,
    generation_reason: round.generation_reason,
    seed_used: round.seed_used,
    matches: matches.map((m) => ({
      id: m.id,
      court_id: m.court_id,
      pair_a_id: m.pair_a_id,
      pair_b_id: m.pair_b_id,
      participants: graph.participants
        .filter((p) => p.match_id === m.id)
        .map((p) => ({ player_id: p.player_id, side: p.side })),
    })),
    rests: graph.rests
      .filter((r) => r.round_id === roundId)
      .map((r) => ({ player_id: r.player_id, consecutive_rest_count: r.consecutive_rest_count })),
  };
}
