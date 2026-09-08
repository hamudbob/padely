import { ReactNode, useState } from "react";
import { BottomSheet } from "./Sheet";

/**
 * A confirmation step for an action that takes something away.
 *
 * WHY THIS EXISTS — a real evening, 8 Sep. Someone sat on the waiting list for
 * a club night, was promoted when a spot opened, and then tapped "Out" by
 * accident on the same screen. There was no confirmation, so the tap went
 * straight through: he was removed, the next person on the list was promoted
 * into his place automatically, and tapping "In" again put him at the BACK of
 * the queue. One mis-tap, no undo, and his evening was given to someone else.
 *
 * The lesson is not "add a dialog to everything". Confirmations are a tax on
 * every correct tap paid to catch the rare wrong one, and an app that asks
 * about everything trains people to dismiss without reading — at which point
 * it protects nobody and merely annoys. So the rule used here is narrow:
 *
 *   ask ONLY when the action takes a thing away that the person cannot simply
 *   take back, and say IN THE MESSAGE what specifically is lost.
 *
 * "Are you sure?" is not that. "Your spot goes to the next person waiting and
 * you'd rejoin at the back of the queue" is: it gives them the fact they need
 * to answer, so the dialog is a decision rather than a speed bump.
 *
 * window.confirm() was the other option, and is used elsewhere in the app. It
 * is wrong here: inside a Capacitor webview it renders a system alert titled
 * with the app's internal origin, it cannot be styled or dismissed by swipe,
 * and — the reason it is disqualified — it BLOCKS the webview thread, so a
 * dialog raised while a score is syncing freezes everything behind it.
 */
export interface ConfirmRequest {
  title: string;
  /** What is actually lost. Concrete beats polite. */
  body: ReactNode;
  /** The affirmative button. Name the act ("Leave the session"), never "OK". */
  confirmLabel: string;
  /** "danger" for anything that removes a person from something. */
  tone?: "danger" | "normal";
  /** The work to do. Kept here so the caller states intent in one place. */
  run: () => Promise<void> | void;
}

export default function ConfirmSheet({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const danger = request.tone !== "normal";

  async function go() {
    if (busy) return;
    setBusy(true);
    try {
      await request.run();
    } finally {
      // Close either way. A failed action reports itself through the page's
      // own note; leaving the sheet open on top of that message would hide
      // the very explanation the person needs.
      setBusy(false);
      onClose();
    }
  }

  return (
    <BottomSheet onClose={busy ? () => undefined : onClose} title={request.title} variant="card">
      <p className="text-[13.5px] leading-relaxed text-ink-2 text-center px-1 mb-5">{request.body}</p>

      {/* Destructive action on top, cancel below it and visually heavier.
          The cancel is the safe choice, so it gets the resting thumb position
          and the solid fill; the confirm has to be chosen deliberately. */}
      <div className="flex flex-col gap-2">
        <button
          onClick={go}
          disabled={busy}
          className={`w-full rounded-full py-3 text-[14px] font-semibold transition-opacity disabled:opacity-60 ${
            danger ? "bg-loss-soft text-loss" : "bg-gold-soft text-gold-ink"
          }`}
        >
          {busy ? "Working…" : request.confirmLabel}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="w-full rounded-full py-3 text-[14px] font-semibold bg-graphite text-ivory disabled:opacity-60"
        >
          Keep things as they are
        </button>
      </div>
    </BottomSheet>
  );
}
