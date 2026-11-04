import type { LocalSession } from "./localSession";

/**
 * Is this phone's copy of the night failing to reach the server, in a way the
 * host should know about? Pure, so it can be tested without a phone.
 *
 * 15 Oct 2026: a host ran a whole evening whose every upload was refused
 * ("Could not find your team."). The screen read the phone's copy, so it
 * looked perfect; nobody could join by code and the night never reached
 * admin. Nothing on screen said so.
 *
 * Quiet on purpose for the ordinary blips: a push in flight, a few seconds of
 * no signal. It speaks when the server has refused, or when the gap is long.
 */
export type SyncProblem =
  | { kind: "offline"; neverUploaded: boolean }
  | { kind: "refused"; neverUploaded: boolean; reason: string }
  | { kind: "behind"; minutes: number };

/** A first upload that hasn't landed after this long is worth mentioning. */
const FIRST_UPLOAD_GRACE_MS = 90_000;
/** Later changes the server hasn't taken for this long. */
const BEHIND_MS = 3 * 60_000;

export function syncProblem(s: LocalSession | null, now: number, online: boolean): SyncProblem | null {
  if (!s) return null;
  const neverUploaded = !s.syncedAt;
  const changedAt = s.changedAt ?? null;
  const owed = neverUploaded || (s.changedAt ?? 0) > (s.pushedChangedAt ?? 0) || !!s.lastError;
  if (!owed) return null;

  // A network failure while the phone thinks it's online (one bar of signal)
  // is the same as offline: worth a line only once it has gone on a while.
  const networkish = !!s.lastError && /failed to fetch|network|load failed|timed? ?out|offline/i.test(s.lastError);
  if (!online || networkish) {
    // Offline is normal on a court. Only worth a line once something is owed
    // and has been for a while.
    const since = neverUploaded ? Date.parse(s.session.created_at) : s.lastReplicatedAt ?? s.syncedAt ?? now;
    return now - (Number.isFinite(since) ? since : now) > FIRST_UPLOAD_GRACE_MS ? { kind: "offline", neverUploaded } : null;
  }

  if (s.lastError) return { kind: "refused", neverUploaded, reason: s.lastError };

  if (neverUploaded) {
    const created = Date.parse(s.session.created_at);
    if (Number.isFinite(created) && now - created > FIRST_UPLOAD_GRACE_MS) {
      return { kind: "refused", neverUploaded: true, reason: "" };
    }
    return null;
  }

  const last = s.lastReplicatedAt ?? s.syncedAt ?? now;
  if (changedAt !== null && now - last > BEHIND_MS) return { kind: "behind", minutes: Math.round((now - last) / 60_000) };
  return null;
}

/** Plain words for the reasons a host can do something about. */
export function friendlyReason(reason: string): string {
  if (/could not find your team/i.test(reason)) return "Your account isn't set up to host yet. Send this to the Padelier admin.";
  if (/not a member of that club/i.test(reason)) return "You're not a member of the club this session is filed under.";
  if (/please sign in|not signed in|jwt|token/i.test(reason)) return "You've been signed out. Sign in again and it will upload.";
  if (/belongs to someone else/i.test(reason)) return "This session belongs to another account.";
  return reason;
}
