import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { isNative } from "./native";
import { supabase } from "./supabase/client";

/**
 * Push notifications: getting a device token, and acting on a tap.
 *
 * Sending is not here — that happens server-side, in the send-push Edge
 * Function. This file's whole job is to make a phone reachable and to route
 * the person somewhere sensible when they tap what arrives.
 *
 * ── When permission is asked for, and why not at launch ───────────────────
 *
 * iOS gives an app exactly ONE chance at the permission prompt. Deny it and
 * the only route back is Settings → Notifications → Padelier, which nobody
 * does. So the prompt is worth spending carefully.
 *
 * Asking on first launch spends it on a stranger: someone who opened the app
 * ninety seconds ago, has not seen a session yet, and has no reason to say
 * yes. Asking after an RSVP spends it on someone who has just committed to
 * being on a court on Tuesday, where "we'll tell you if the time changes or a
 * spot opens" is an obviously good trade. Same prompt, completely different
 * answer rate.
 *
 * `ensurePushRegistered` is therefore called from those moments — RSVP,
 * joining a club — and not from app start.
 *
 * ── The environment problem, and an honest compromise ─────────────────────
 *
 * APNs is two services (sandbox for Xcode builds, production for TestFlight
 * and the App Store) and a token from one is rejected by the other. The
 * device knows which it is, via the `aps-environment` entitlement — but that
 * is not readable from JavaScript, and Capacitor's plugin does not surface
 * it. Reading it would mean writing a small native plugin of our own.
 *
 * So this reports a HINT, from VITE_APNS_ENV, defaulting to production. The
 * sender treats it as a hint rather than a fact: if APNs answers
 * BadDeviceToken it retries the other environment and corrects the stored
 * row. That is better than a build-time flag anybody can forget to set, and
 * it converges on the truth after one failed send rather than staying wrong
 * forever.
 */

const APNS_ENV: "sandbox" | "production" =
  (import.meta.env.VITE_APNS_ENV as "sandbox" | "production" | undefined) ?? "production";

const BUNDLE_ID = "id.padelier.app";

/** The token this device most recently registered, so sign-out can undo it. */
let currentToken: string | null = null;

/**
 * Ask for permission if we haven't, then register and store the token.
 *
 * Returns what happened, so a caller can decide whether to say anything. It
 * never throws: failing to register for push is not a reason to interrupt
 * whatever the person was actually doing.
 *
 *   "granted"      registered, token stored
 *   "denied"       they said no, or said no previously
 *   "unsupported"  running in a browser
 *   "error"        something went wrong; logged, not surfaced
 */
export async function ensurePushRegistered(): Promise<"granted" | "denied" | "unsupported" | "error"> {
  if (!isNative()) return "unsupported";

  try {
    let status = await PushNotifications.checkPermissions();

    // Only prompt when iOS says it would actually show one. Calling
    // requestPermissions after a denial returns "denied" without showing
    // anything, which is fine, but checking first keeps the intent honest.
    if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") return "denied";

    // register() is what actually talks to APNs. The token comes back
    // asynchronously through the 'registration' listener attached in
    // startPushListeners, NOT as a return value here.
    await PushNotifications.register();
    return "granted";
  } catch (err) {
    console.warn("Push registration failed:", err);
    return "error";
  }
}

/**
 * Attach the listeners. Called once, from App, inside the Router so it can
 * navigate.
 *
 * Returns a cleanup function.
 */
export function startPushListeners(navigate: (path: string) => void): () => void {
  if (!isNative()) return () => undefined;

  const handles: Promise<{ remove: () => Promise<void> }>[] = [];

  // The token. Arrives after register(), and again whenever iOS rotates it —
  // after an OS update, a restore from backup, or a reinstall. Storing it
  // every time is the point: a stale token is not an error anyone sees, it is
  // just a person who quietly stops being told things.
  handles.push(
    PushNotifications.addListener("registration", (token: Token) => {
      currentToken = token.value;
      void supabase
        .rpc("register_device_token", {
          p_token: token.value,
          p_platform: "ios",
          p_environment: APNS_ENV,
          p_bundle_id: BUNDLE_ID,
        })
        .then(({ error }) => {
          if (error) console.warn("Could not store the device token:", error.message);
        });
    }),
  );

  handles.push(
    PushNotifications.addListener("registrationError", (err) => {
      // Almost always one of: no Push capability in the target, no
      // aps-environment entitlement, or running on a Simulator — which cannot
      // register with APNs at all, however willing it looks.
      console.warn("APNs registration error:", err);
    }),
  );

  // A tap. `data` is whatever the sender put in the payload; `path` is our
  // own convention and is the only thing we route on.
  handles.push(
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const path = (action.notification?.data as { path?: string } | undefined)?.path;
      // Only in-app paths. A notification is data from the network, and
      // routing on an absolute URL from it would be an open redirect wearing
      // a different hat.
      if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) {
        navigate(path);
      }
    }),
  );

  return () => {
    for (const h of handles) void h.then((handle) => handle.remove());
  };
}

/**
 * Forget this device.
 *
 * Called on sign-out, before the session goes — the RPC needs a signed-in
 * caller. Without this, the next person to sign in on a shared phone inherits
 * the previous person's notifications until they happen to register, and the
 * one who signed out keeps receiving them until then.
 */
export async function unregisterThisDevice(): Promise<void> {
  if (!isNative() || !currentToken) return;
  try {
    await supabase.rpc("unregister_device_token", { p_token: currentToken });
    currentToken = null;
  } catch (err) {
    console.warn("Could not unregister the device token:", err);
  }
}
