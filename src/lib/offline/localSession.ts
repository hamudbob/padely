import { SessionDraft } from "../supabase/sessionActions";
import { RoundResult } from "../scheduling/types";

/**
 * A session that exists only on this phone, until it doesn't.
 *
 * WHY. Padel is played on courts with bad signal, and starting a session was
 * the last thing that still needed bars. Scoring already survives offline
 * (scoreSyncQueue); the draw and the standings were already computed on the
 * device; the only genuinely server-shaped thing was the row ids, because
 * createLobby and finalizeAndStart are a chain of six inserts each needing
 * the ids the last one returned.
 *
 * So the phone generates the ids too, and the whole graph with them.
 *
 * ── The rows are stored in DATABASE shape, deliberately ──────────────────
 *
 * snake_case, same column names, same value types — `display_name`, not
 * `name`. It looks wrong in a TypeScript file and it is the single most
 * important decision here.
 *
 * getHostLiveSnapshot, getSessionStandings and getRoundHistory all follow the
 * same pattern: fetch raw rows, then compute in JavaScript. The computing is
 * the part with the rules in it — points, wins, rest fairness, the ranking
 * basis. If a local session stored its own friendlier shape, every one of
 * those functions would need a second assembly path, and the day one of them
 * drifted from the other, the standings would silently change when a session
 * synced. Nobody would be able to say which number was right.
 *
 * Storing rows exactly as Supabase returns them means the local branch
 * substitutes the FETCH and nothing else. The rules run once, in one place,
 * on either source.
 *
 * ── What is deliberately impossible offline ──────────────────────────────
 *
 * Players joining by code, the public live link, and anything another
 * person's phone does. Those need a server by definition. An offline session
 * is one where the host types the roster — which is what a host on a dead
 * court is doing anyway.
 */

const STORAGE_KEY = "padelier:localSessions:v1";

/* ── Row shapes: these mirror the tables, column for column ─────────────── */

export interface LocalSessionRow {
  id: string;
  club_id: string | null;
  name: string;
  format: string;
  scoring_format: string;
  ranking_basis: string;
  status: "live" | "ended";
  join_code: string;
  public_token: string;
  scheduling_seed: number;
  min_players_per_court: number;
  team_score_mode: string | null;
  fixed_partner_style: string | null;
  counts_for_league: boolean;
  created_at: string;
  started_at: string;
  ended_at: string | null;
}

export interface LocalCourtRow {
  id: string;
  session_id: string;
  ordinal: number;
  display_name: string;
  available: boolean;
}

export interface LocalPlayerRow {
  id: string;
  session_id: string;
  display_name: string;
  gender: string;
  linked_user_id: string | null;
  team_side: string | null;
  preferred_side: string | null;
  status: "active" | "late" | "left";
  matches_played: number;
  rests: number;
  joined_at: string;
}

export interface LocalPairRow {
  id: string;
  session_id: string;
  label: string;
  is_auto_label: boolean;
  team_side: string | null;
  player_a_id: string;
  player_b_id: string;
}

export interface LocalRoundRow {
  id: string;
  session_id: string;
  sequence: number;
  status: "planned" | "in_progress" | "scored" | "superseded";
  generation_reason: string;
  seed_used: number;
  generated_at: string;
}

export interface LocalMatchRow {
  id: string;
  round_id: string;
  court_id: string;
  pair_a_id: string | null;
  pair_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  outcome: string | null;
  status: "not_started" | "in_progress" | "final" | "cancelled";
}

export interface LocalParticipantRow {
  match_id: string;
  player_id: string;
  side: "A" | "B";
}

export interface LocalRestRow {
  round_id: string;
  player_id: string;
  consecutive_rest_count: number;
}

export interface LocalSession {
  session: LocalSessionRow;
  courts: LocalCourtRow[];
  players: LocalPlayerRow[];
  pairs: LocalPairRow[];
  rounds: LocalRoundRow[];
  matches: LocalMatchRow[];
  participants: LocalParticipantRow[];
  rests: LocalRestRow[];
  /** Set once the server has accepted it; the session then lives there. */
  syncedAt: number | null;
  /** Last sync failure, for showing the host something honest. */
  lastError: string | null;
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

function readAll(): Record<string, LocalSession> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, LocalSession>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, LocalSession>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    // A full disk here is not a cosmetic failure — it is a session that will
    // not survive the app being killed. Loud, so the caller can refuse to
    // start rather than pretend.
    throw new Error("Could not save the session on this device. Free up some space and try again.");
  }
}

export function getLocalSession(sessionId: string): LocalSession | null {
  return readAll()[sessionId] ?? null;
}

/** True while the session exists ONLY here. The reads branch on this. */
export function isLocalOnly(sessionId: string): boolean {
  const s = readAll()[sessionId];
  return Boolean(s && !s.syncedAt);
}

export function listUnsyncedSessions(): LocalSession[] {
  return Object.values(readAll()).filter((s) => !s.syncedAt);
}

export function saveLocalSession(next: LocalSession): void {
  const all = readAll();
  all[next.session.id] = next;
  writeAll(all);
}

/**
 * Mark synced, and keep the row for a while rather than deleting it.
 *
 * The server is now the source of truth, so nothing reads this any more —
 * but a host who has just watched their evening upload is entitled to have it
 * still be there if the next request fails. It is cleared by
 * `forgetSyncedSessions` on a later launch, once there is no doubt.
 */
export function markSynced(sessionId: string): void {
  const all = readAll();
  const s = all[sessionId];
  if (!s) return;
  s.syncedAt = Date.now();
  s.lastError = null;
  writeAll(all);
}

export function recordSyncError(sessionId: string, message: string): void {
  const all = readAll();
  const s = all[sessionId];
  if (!s) return;
  s.lastError = message;
  writeAll(all);
}

/** Drop sessions that synced more than a day ago. Called at startup. */
export function forgetSyncedSessions(): void {
  const all = readAll();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, s] of Object.entries(all)) {
    if (s.syncedAt && s.syncedAt < cutoff) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) writeAll(all);
}

/* ── Building one ────────────────────────────────────────────────────────── */

export const localUuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : // Fallback for anything without randomUUID. Not cryptographically
      // interesting — these are row ids, and the server re-checks ownership.
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export function randomJoinCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function randomPublicToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the whole graph from what the wizard already has.
 *
 * This is finalizeAndStart's persist logic with every `.insert().select("id")`
 * replaced by an id we made up. The mapping from the wizard's tempIds to real
 * uuids happens once, here, exactly as the online path maps them from
 * returned rows — so `previewRounds`, which speaks tempIds, resolves the same
 * way in both.
 */
export function buildLocalSession(
  draft: SessionDraft,
  previewRounds: RoundResult[],
  schedulingSeed: number,
): LocalSession {
  const sessionId = localUuid();
  const now = new Date().toISOString();

  const courts: LocalCourtRow[] = draft.courts.map((c, i) => ({
    id: localUuid(),
    session_id: sessionId,
    ordinal: i + 1,
    display_name: c.name,
    available: true,
  }));

  const playerIdByTempId = new Map<string, string>();
  const players: LocalPlayerRow[] = draft.players.map((p) => {
    const id = localUuid();
    playerIdByTempId.set(p.tempId, id);
    return {
      id,
      session_id: sessionId,
      display_name: p.name,
      gender: p.gender,
      linked_user_id: p.linkedUserId ?? null,
      team_side: p.teamSide ?? null,
      preferred_side: p.preferredSide ?? null,
      status: "active",
      matches_played: 0,
      rests: 0,
      joined_at: now,
    };
  });

  const nameByTempId = new Map(draft.players.map((p) => [p.tempId, p.name]));
  const pairs: LocalPairRow[] = (draft.pairs ?? []).map((pair) => ({
    id: localUuid(),
    session_id: sessionId,
    // Same "A & B" first-name label the online path builds.
    label: `${(nameByTempId.get(pair.playerA) ?? "?").split(" ")[0]}${(nameByTempId.get(pair.playerB) ?? "?").split(" ")[0]}`,
    is_auto_label: true,
    team_side: null,
    player_a_id: playerIdByTempId.get(pair.playerA)!,
    player_b_id: playerIdByTempId.get(pair.playerB)!,
  }));

  const rounds: LocalRoundRow[] = [];
  const matches: LocalMatchRow[] = [];
  const participants: LocalParticipantRow[] = [];
  const rests: LocalRestRow[] = [];

  previewRounds.forEach((round, i) => {
    const roundId = localUuid();
    rounds.push({
      id: roundId,
      session_id: sessionId,
      sequence: i + 1,
      // Round 1 is being played the moment Start is pressed; the rest are
      // drawn ahead. Identical to the online path, because the live screen
      // decides what to show from exactly this.
      status: i === 0 ? "in_progress" : "planned",
      generation_reason:
        i === 0 ? "Initial draw at session start." : "Pre-generated with the full schedule at session start.",
      seed_used: schedulingSeed + (i + 1),
      generated_at: now,
    });

    for (const match of round.matches) {
      const matchId = localUuid();
      matches.push({
        id: matchId,
        round_id: roundId,
        court_id: courts[match.courtIndex].id,
        pair_a_id: null,
        pair_b_id: null,
        score_a: null,
        score_b: null,
        outcome: null,
        status: "not_started",
      });
      for (const tempId of match.teamA) {
        participants.push({ match_id: matchId, player_id: playerIdByTempId.get(tempId)!, side: "A" });
      }
      for (const tempId of match.teamB) {
        participants.push({ match_id: matchId, player_id: playerIdByTempId.get(tempId)!, side: "B" });
      }
    }

    for (const tempId of round.restingIds) {
      rests.push({ round_id: roundId, player_id: playerIdByTempId.get(tempId)!, consecutive_rest_count: 0 });
    }
  });

  return {
    session: {
      id: sessionId,
      club_id: draft.clubId ?? null,
      name: draft.name,
      format: draft.format,
      scoring_format: draft.scoringFormat,
      ranking_basis: draft.rankingBasis,
      status: "live",
      join_code: randomJoinCode(),
      public_token: randomPublicToken(),
      scheduling_seed: schedulingSeed,
      min_players_per_court: 4,
      team_score_mode: draft.teamScoreMode ?? null,
      fixed_partner_style: draft.fixedPartnerStyle ?? null,
      counts_for_league: draft.clubId ? draft.countsForLeague ?? true : false,
      created_at: now,
      started_at: now,
      ended_at: null,
    },
    courts,
    players,
    pairs,
    rounds,
    matches,
    participants,
    rests,
    syncedAt: null,
    lastError: null,
  };
}

/* ── Mutating one while it's still local ─────────────────────────────────── */

/** Record a score. Mirrors what submitMatchScore writes server-side. */
export function setLocalMatchScore(
  sessionId: string,
  matchId: string,
  scoreA: number | null,
  scoreB: number | null,
): void {
  const all = readAll();
  const s = all[sessionId];
  if (!s) return;
  const match = s.matches.find((m) => m.id === matchId);
  if (!match) return;

  match.score_a = scoreA;
  match.score_b = scoreB;
  match.status = scoreA !== null && scoreB !== null ? "final" : "not_started";
  match.outcome =
    scoreA === null || scoreB === null ? null : scoreA > scoreB ? "win_a" : scoreB > scoreA ? "win_b" : "draw";

  // A round is scored once every match in it is. The live screen gates "next
  // round" on this, so getting it wrong offline would either block a host or
  // let them advance over an unplayed court.
  const round = s.rounds.find((r) => r.id === match.round_id);
  if (round) {
    const siblings = s.matches.filter((m) => m.round_id === round.id);
    round.status = siblings.every((m) => m.status === "final") ? "scored" : "in_progress";
  }

  // matches_played drives rest fairness in the next draw, so it has to move
  // here too — the online path has a trigger doing this.
  for (const p of s.players) {
    p.matches_played = s.participants.filter((mp) => {
      if (mp.player_id !== p.id) return false;
      const m = s.matches.find((x) => x.id === mp.match_id);
      return m?.status === "final";
    }).length;
  }

  writeAll(all);
}

export function setLocalSessionEnded(sessionId: string): void {
  const all = readAll();
  const s = all[sessionId];
  if (!s) return;
  s.session.status = "ended";
  s.session.ended_at = new Date().toISOString();
  writeAll(all);
}

/** The payload create_session_from_payload (0060) expects. */
export function toSyncPayload(s: LocalSession): Record<string, unknown> {
  return {
    session: s.session,
    courts: s.courts,
    players: s.players,
    pairs: s.pairs,
    rounds: s.rounds,
    rests: s.rests,
    matches: s.matches,
    participants: s.participants,
  };
}

/**
 * Player status on a local session — "left", and undoing it.
 *
 * The next draw filters on `status === "active"`, and for a local session it
 * reads THIS array, so without these the Manage tab silently did nothing
 * offline: the host marked someone as left, the row stayed active, and the
 * next round put them back on court.
 */
export function setLocalPlayerStatus(
  sessionId: string,
  playerId: string,
  status: "active" | "left",
): boolean {
  const all = readAll();
  const s = all[sessionId];
  if (!s) return false;
  const player = s.players.find((p) => p.id === playerId);
  if (!player) return false;
  player.status = status;
  writeAll(all);
  return true;
}

/** Which local session owns this player, if any. Manage acts on a player id. */
export function localSessionIdForPlayer(playerId: string): string | null {
  for (const s of Object.values(readAll())) {
    if (s.syncedAt) continue;
    if (s.players.some((p) => p.id === playerId)) return s.session.id;
  }
  return null;
}
