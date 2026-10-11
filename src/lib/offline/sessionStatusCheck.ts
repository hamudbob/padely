import { supabase } from "../supabase/client";
import {
  listAllLocalSessions,
  getLocalSession,
  setLocalSessionEnded,
  setLocalSessionReopened,
  hasUnpushedChanges,
  LocalSession,
} from "./localSession";
import { pullCoHostChanges } from "./coHostSync";

/**
 * Does this phone still agree with the server about which nights are live?
 *
 * The phone holds the session and normally decides — but since 0072 the
 * server can end a night on its own (12 hours with no activity), and an admin
 * or the host can reopen one. The phone learns either here, on launch, on
 * returning to the app and once a minute (startLocalSessionSync), and when the
 * host screen opens. Ending it locally then sends it through the normal path:
 * the push, the ratings and the league row — so a forgotten night is rated the
 * next time its host opens the app.
 *
 * Status only ever moves one way from the phone's side too: an ended session
 * becomes live again only when the server says it was REOPENED after this
 * phone ended it, never merely because the server still thinks it is live.
 */

export const IDLE_MS = 12 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any; // 0072's columns/RPC are not in database.types; always called ON the client

type Row = {
  id: string;
  status: string;
  ended_at: string | null;
  reopened_at?: string | null;
  last_activity_at?: string | null;
};

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** When this phone last changed the night (a score, a round, a player). */
export function lastLocalActivity(s: LocalSession): number {
  return s.changedAt ?? time(s.session.started_at) ?? time(s.session.created_at) ?? Date.now();
}

async function fetchRows(ids: string[]): Promise<Row[]> {
  const full = await db.from("sessions").select("id, status, ended_at, reopened_at, last_activity_at").in("id", ids);
  if (!full.error) return (full.data ?? []) as Row[];
  // Before 0072 is applied those two columns don't exist; the end itself can
  // still be noticed.
  const basic = await db.from("sessions").select("id, status, ended_at").in("id", ids);
  if (basic.error) throw basic.error;
  return (basic.data ?? []) as Row[];
}

let inFlight: Promise<string[]> | null = null;

/**
 * Reconcile local sessions with the server. Returns the ids whose status
 * changed on this phone. Never throws: a failed check is retried next time.
 *
 * A call made while one is already running waits for THAT one rather than
 * returning early: the host screen asks on open at the same moment the
 * app-wide check does on launch, and an early "nothing changed" left the
 * screen showing a night that had in fact just ended.
 */
export function reconcileSessionStatus(onlyId?: string): Promise<string[]> {
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return Promise.resolve([]);
  if (inFlight) return inFlight;
  inFlight = run(onlyId).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(onlyId?: string): Promise<string[]> {
  const changed: string[] = [];
  try {
    const now = Date.now();
    const mine = listAllLocalSessions().filter((s) => !onlyId || s.session.id === onlyId);

    // Never reached the server: nothing there to ask, so the same 12-hour
    // rule is applied here. It then uploads already ended.
    for (const s of mine) {
      if (s.syncedAt || s.session.status !== "live") continue;
      const last = lastLocalActivity(s);
      if (now - last > IDLE_MS) {
        setLocalSessionEnded(s.session.id, new Date(last).toISOString());
        changed.push(s.session.id);
      }
    }

    // Ended ones only matter for a reopen, and the phone forgets ended
    // sessions after a day anyway.
    const ids = mine.filter((s) => s.syncedAt).map((s) => s.session.id);
    if (ids.length === 0) return changed;
    const rows = await fetchRows(ids);

    for (const row of rows) {
      const local = getLocalSession(row.id);
      if (!local) continue;
      const localStatus = local.session.status;

      if (row.status === "ended" && localStatus === "live") {
        // Ended elsewhere: the idle sweep, or the host on another device.
        // Take any co-host scores in first, while the copy is still live, so
        // the podium this phone builds has them.
        if ((local.coHostCount ?? 0) > 0) await pullCoHostChanges(row.id).catch(() => null);
        setLocalSessionEnded(row.id, row.ended_at);
        changed.push(row.id);
        continue;
      }

      if (
        row.status === "live" &&
        localStatus === "live" &&
        row.last_activity_at &&
        now - (time(row.last_activity_at) ?? now) > IDLE_MS &&
        now - lastLocalActivity(local) > IDLE_MS &&
        !hasUnpushedChanges(local)
      ) {
        // Idle on both sides and pg_cron hasn't got to it (or isn't enabled):
        // the server applies its own rule for this one session.
        const { data, error } = await db.rpc("end_session_if_idle", { p_session_id: row.id });
        if (!error && data === "ended") {
          if ((local.coHostCount ?? 0) > 0) await pullCoHostChanges(row.id).catch(() => null);
          setLocalSessionEnded(row.id, row.last_activity_at);
          changed.push(row.id);
        }
        continue;
      }

      if (
        row.status === "live" &&
        localStatus === "ended" &&
        row.reopened_at &&
        (time(row.reopened_at) ?? 0) > (time(local.session.ended_at) ?? 0)
      ) {
        setLocalSessionReopened(row.id);
        changed.push(row.id);
      }
    }
  } catch (e) {
    console.warn("Session status check skipped:", e);
  }
  return changed;
}
