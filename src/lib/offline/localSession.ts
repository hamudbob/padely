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
  /**
   * When the server last accepted the WHOLE graph, not just the first upload.
   *
   * syncedAt is stamped once and never touched again, so on 12 Sep 2026 it was
   * still pointing at the moment the session STARTED while replication had
   * been dead for hours — and the 24-hour sweep below, reading it, deleted the
   * only surviving copy of the evening. Sweeping needs to ask "when did the
   * server last actually take this?", which is this field.
   */
  lastReplicatedAt: number | null;
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

/**
 * Fired after every local mutation, so replication can follow it.
 *
 * A callback registry rather than importing the sync module directly: this
 * file must not depend on Supabase, or the store and the syncer become a
 * cycle. The syncer registers itself at startup.
 */
type ChangeListener = (sessionId: string) => void;
const changeListeners: ChangeListener[] = [];

export function onLocalSessionChange(fn: ChangeListener): () => void {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i >= 0) changeListeners.splice(i, 1);
  };
}

function announce(all: Record<string, LocalSession>): void {
  // Announce every session present; the syncer debounces and only pushes the
  // ones that are live. Cheap, and it cannot miss a mutation the way naming a
  // single id at each call site eventually would.
  for (const id of Object.keys(all)) {
    for (const fn of changeListeners) {
      try {
        fn(id);
      } catch {
        /* a listener must never break a save */
      }
    }
  }
}

function writeAll(all: Record<string, LocalSession>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    announce(all);
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

/**
 * True while the server has NO copy of this session yet.
 *
 * Use this only for things that genuinely need a server row to exist: the
 * score queue (its match ids don't exist yet), ending (nothing to update),
 * and the podium (a server-composed view).
 */
export function isLocalOnly(sessionId: string): boolean {
  const s = readAll()[sessionId];
  return Boolean(s && !s.syncedAt);
}

/**
 * True while this device holds the session's rows at all — synced or not.
 *
 * THIS IS THE ONE THE READS AND THE LIVE ACTIONS BRANCH ON, and the
 * distinction cost an evening to find. `syncedAt` used to mean two things at
 * once: "the server has a copy" and "stop using local". So a session started
 * offline, played, and then reconnected would be handed back to the
 * server-only path the moment it uploaded — and going offline again left it
 * with no local rows and a Next Round gate it could never satisfy. The host
 * was locked out of a session running in front of them.
 *
 * They are separate facts. The server having a copy does not stop this phone
 * from being the one running the session; it just means the copy is safe.
 */
export function hasLocalSession(sessionId: string): boolean {
  return Boolean(readAll()[sessionId]);
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
  s.lastReplicatedAt = Date.now();
  s.lastError = null;
  writeAll(all);
}

/** The server has just accepted the whole graph. Only this clears lastError. */
export function markReplicated(sessionId: string): void {
  const all = readAll();
  const s = all[sessionId];
  if (!s) return;
  s.lastReplicatedAt = Date.now();
  s.lastError = null;
  writeAll(all);
}

/** Has the server fallen behind this device? Drives the host's warning. */
export function replicationLagMs(sessionId: string): number | null {
  const s = getLocalSession(sessionId);
  if (!s || !s.syncedAt) return null;
  const last = s.lastReplicatedAt ?? s.syncedAt;
  return Date.now() - last;
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
    // ENDED and synced, not merely synced. A live session's rows are what the
    // live screen reads; dropping them a day into a long-running session
    // would take the app offline-hostile again for the very session that is
    // still being played.
    // lastReplicatedAt, NOT syncedAt. syncedAt is stamped once at first
    // upload; a session whose replication broke afterwards still looked
    // "synced a day ago" and was swept while holding the only copy of the
    // evening. Fall back to syncedAt only for rows written before this field
    // existed. A session the server has never fully taken is never dropped.
    const lastOk = s.lastReplicatedAt ?? s.syncedAt;
    if (s.session.status === "ended" && lastOk && lastOk < cutoff) {
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
  /**
   * When the wizard already minted a draft session server-side — it does, on
   * the Players step, so people can join by code before Start — reuse that
   * identity rather than inventing a new one. `alreadyOnServer` then sends it
   * down the REPLICATE path (upsert the missing children) instead of the
   * CREATE path, which would refuse a session that already exists.
   */
  existing?: { sessionId: string; joinCode: string; publicToken: string; alreadyOnServer: boolean },
): LocalSession {
  const sessionId = existing?.sessionId ?? localUuid();
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
      join_code: existing?.joinCode ?? randomJoinCode(),
      public_token: existing?.publicToken ?? randomPublicToken(),
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
    syncedAt: existing?.alreadyOnServer ? Date.now() : null,
    lastReplicatedAt: existing?.alreadyOnServer ? Date.now() : null,
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

/**
 * The session's ranking basis, on this device.
 *
 * Every host-side read of the basis comes from here -- the standings engine,
 * the Standings tab and the Mexicano court ladder. A server-only write left
 * the host ranking on the old basis while everyone else ranked on the new one,
 * for the rest of the night, with nothing on screen to say so.
 *
 * Returns false when this device does not hold the session, so the caller can
 * fall through to the server path.
 */
export function setLocalRankingBasis(
  sessionId: string,
  basis: "points_first" | "wins_first",
): boolean {
  const all = readAll();
  const s = all[sessionId];
  if (!s) return false;
  s.session.ranking_basis = basis;
  writeAll(all);
  return true;
}

/**
 * The owner-only lineup swap, on this device.
 *
 * A faithful mirror of swap_round_players (0033): trade two on-court players by
 * exchanging their exact match+side slots, or pull a rester on and sit the other
 * player down. Locked once ANY match in the session is final, same as the RPC,
 * so a finished result can never move under a player's feet.
 *
 * It exists because the RPC alone stopped working the day Start went
 * local-first: the chips rendered, the swap went to a server row nobody was
 * reading, and the host's screen never changed. Same shape of bug as Redraw and
 * setRankingBasis.
 *
 * Returns "not-local" when this device does not hold the session, so the caller
 * falls through to the server path.
 */
export function swapLocalRoundPlayers(
  roundId: string,
  playerA: string,
  playerB: string,
): "not-local" | "locked" | "ok" {
  const all = readAll();
  const s = Object.values(all).find((sess) => sess.rounds.some((r) => r.id === roundId));
  if (!s) return "not-local";

  if (s.matches.some((m) => m.status === "final")) return "locked";
  if (playerA === playerB) return "ok";

  const roundMatchIds = new Set(s.matches.filter((m) => m.round_id === roundId).map((m) => m.id));
  const slotA = s.participants.find((mp) => roundMatchIds.has(mp.match_id) && mp.player_id === playerA);
  const slotB = s.participants.find((mp) => roundMatchIds.has(mp.match_id) && mp.player_id === playerB);

  if (slotA && slotB) {
    // Both on court: exchange match + side. Read both slots BEFORE writing
    // either, or the second read sees the first write and the swap collapses.
    const aMatch = slotA.match_id;
    const aSide = slotA.side;
    slotA.match_id = slotB.match_id;
    slotA.side = slotB.side;
    slotB.match_id = aMatch;
    slotB.side = aSide;
  } else if (slotA || slotB) {
    // One plays, one rests: the rester takes the slot, the player sits down.
    const slot = (slotA ?? slotB)!;
    const onCourt = slotA ? playerA : playerB;
    const resting = slotA ? playerB : playerA;
    slot.player_id = resting;
    s.rests = s.rests.filter((rr) => !(rr.round_id === roundId && rr.player_id === resting));
    if (!s.rests.some((rr) => rr.round_id === roundId && rr.player_id === onCourt)) {
      s.rests.push({ round_id: roundId, player_id: onCourt, consecutive_rest_count: 0 });
    }
  } else {
    return "ok"; // both resting: nothing to do
  }

  writeAll(all);
  return "ok";
}

/** Which local session owns this player, if any. Manage acts on a player id. */
export function localSessionIdForPlayer(playerId: string): string | null {
  for (const s of Object.values(readAll())) {
    if (s.players.some((p) => p.id === playerId)) return s.session.id;
  }
  return null;
}

/** Which local session owns this round, if any. Round actions act on a round id. */
export function localSessionIdForRound(roundId: string): string | null {
  for (const s of Object.values(readAll())) {
    if (s.rounds.some((r) => r.id === roundId)) return s.session.id;
  }
  return null;
}

/** Every session this device holds, newest first. For merging into Play. */
export function listAllLocalSessions(): LocalSession[] {
  return Object.values(readAll()).sort((a, b) =>
    b.session.started_at.localeCompare(a.session.started_at),
  );
}
