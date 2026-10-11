import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { ensurePushRegistered, getPushPermission } from "../../lib/push";

/**
 * Settings → Notifications. Where someone can turn push on if they were never
 * asked (or said "later"), see that it's off in iOS Settings if they said no,
 * and send themselves a test to prove the whole chain works on their phone.
 */

type Perm = "granted" | "denied" | "prompt" | "unsupported" | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any; // send_test_push (0073) is not in database.types; called ON the client

export default function NotificationsSettings({ label }: { label: string }) {
  const [perm, setPerm] = useState<Perm>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getPushPermission().then(setPerm);
  }, []);

  async function turnOn() {
    setBusy(true);
    setNote(null);
    const r = await ensurePushRegistered();
    setPerm(await getPushPermission());
    if (r === "denied") setNote({ ok: false, text: "Notifications are off for Padelier. Turn them on in iPhone Settings → Padelier → Notifications." });
    if (r === "error") setNote({ ok: false, text: "Couldn't register this phone. Try again in a moment." });
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const { data, error } = await db.rpc("send_test_push");
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { devices?: number; configured?: boolean };
      if (!r.devices) {
        setNote({
          ok: false,
          text:
            perm === "unsupported"
              ? "No phone is registered for your account yet. Open the Padelier app on your iPhone and turn notifications on there."
              : "This phone hasn't registered yet. Close Padelier, open it again, then try once more.",
        });
      } else if (!r.configured) {
        setNote({ ok: false, text: "It's in your notifications list, but push sending isn't switched on yet." });
      } else {
        setNote({ ok: true, text: "Sent. It should arrive in a few seconds." });
      }
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "That didn't work." });
    } finally {
      setBusy(false);
    }
  }

  const status =
    perm === "granted"
      ? "On for this phone"
      : perm === "denied"
        ? "Off — turn on in iPhone Settings → Padelier"
        : perm === "prompt"
          ? "Not turned on yet"
          : perm === "unsupported"
            ? "Sent to the Padelier app on your iPhone"
            : "…";

  return (
    <>
      <p className={`${label} mb-2 px-1`}>Notifications</p>
      <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-5">
        <div className="px-4 py-3.5">
          <p className="text-[14px] font-semibold text-graphite">Push notifications</p>
          <p className="text-[12px] text-warm-gray mt-0.5">{status}</p>
          <p className="text-[12px] text-ink-2 mt-2 leading-relaxed">
            Join requests for your sessions, when a session you're in goes live, an hour before a club session,
            a place off the waitlist, and the final standings.
          </p>
        </div>
        {perm === "prompt" && (
          <>
            <div className="h-px bg-line" />
            <button
              onClick={turnOn}
              disabled={busy}
              className="w-full text-left px-4 py-3.5 text-[14px] font-semibold text-graphite active:bg-surface-2 disabled:opacity-40"
            >
              Turn on notifications
            </button>
          </>
        )}
        <div className="h-px bg-line" />
        <button
          onClick={test}
          disabled={busy}
          className="w-full text-left px-4 py-3.5 text-[14px] font-semibold text-graphite active:bg-surface-2 disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send a test notification"}
        </button>
        {note && (
          <p className={`px-4 pb-3.5 -mt-1 text-[12.5px] leading-snug ${note.ok ? "text-win" : "text-ink-2"}`}>{note.text}</p>
        )}
      </div>
    </>
  );
}
