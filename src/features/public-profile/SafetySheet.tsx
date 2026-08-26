import { useState } from "react";
import Sheet from "../shell/Sheet";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { blockUser, reportUser, REPORT_REASONS, ReportReason } from "../../lib/supabase/safetyQueries";

/**
 * Report or block, from someone's public profile.
 *
 * One sheet for both because they are one decision in the person's head — "I
 * don't want this" — and splitting them makes you choose a category before you
 * have decided anything. Report leads, because it is the one that helps
 * somebody else too; blocking is offered alongside it, since most people
 * reporting a photo also want it gone from their own screen immediately.
 *
 * Nothing here is reassuring about consequences we can't promise. It does not
 * say "we'll remove them" or "they'll be banned" — it says a person will read
 * it, which is true.
 */
export default function SafetySheet({
  userId,
  displayName,
  onClose,
  onBlocked,
}: {
  userId: string;
  displayName: string;
  onClose: () => void;
  onBlocked: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "report" | "confirm-block">("menu");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  async function submitReport() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportUser(userId, reason, detail);
      if (alsoBlock) await blockUser(userId);
      setSent(true);
      if (alsoBlock) onBlocked();
    } catch (err) {
      setError(withFallback(err, "Couldn't send that just now."));
      setBusy(false);
    }
  }

  async function doBlock() {
    setBusy(true);
    setError(null);
    try {
      await blockUser(userId);
      onBlocked();
      onClose();
    } catch (err) {
      setError(withFallback(err, "Couldn't block them just now."));
      setBusy(false);
    }
  }

  const panel =
    "w-full max-w-sm rounded-3xl bg-ivory px-5 pt-5 pb-6 shadow-[0_8px_40px_rgba(13,13,13,0.28)]";
  const primary =
    "w-full rounded-full px-4 py-3.5 font-semibold text-[14px] text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40";
  const quiet =
    "w-full rounded-full px-4 py-3.5 font-semibold text-[14px] border border-line text-ink-2 bg-surface active:scale-[0.99] transition-transform disabled:opacity-40";

  return (
    <Sheet>
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-graphite/55 px-4 pb-4 anim-fade" role="dialog" aria-modal="true">
        <div className={panel}>
          {sent ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-win-soft border border-win/25 flex items-center justify-center mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#27754A" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 className="font-serif text-[21px] font-medium text-graphite leading-tight">Thanks — that's with us</h2>
              <p className="text-[13px] text-ink-2 leading-relaxed mt-2">
                A person reads every report. We won't tell {displayName} who sent it.
                {alsoBlock ? " You won't see their profile any more either." : ""}
              </p>
              <button onClick={onClose} className={`${primary} mt-5`}>Done</button>
            </>
          ) : mode === "menu" ? (
            <>
              <h2 className="font-serif text-[21px] font-medium text-graphite leading-tight">{displayName}</h2>
              <p className="text-[12.5px] text-warm-gray mt-1">What would you like to do?</p>
              <div className="mt-4 space-y-2.5">
                <button onClick={() => setMode("report")} className={quiet}>Report this player</button>
                <button onClick={() => setMode("confirm-block")} className={quiet}>Block them</button>
                <button onClick={onClose} className="w-full text-[13px] font-semibold text-warm-gray py-3 active:opacity-70">Cancel</button>
              </div>
            </>
          ) : mode === "confirm-block" ? (
            <>
              <h2 className="font-serif text-[21px] font-medium text-graphite leading-tight">Block {displayName}?</h2>
              {/* Said plainly, because the wrong expectation here is the one
                  that causes trouble: people assume blocking removes someone
                  from tonight's game, and it doesn't. */}
              <p className="text-[13px] text-ink-2 leading-relaxed mt-2">
                You won't see their name, photo or bio anywhere, and neither will they see yours. They
                can't invite you to a club, and they'll drop out of your partner and rival lists.
              </p>
              <p className="text-[12.5px] text-warm-gray leading-relaxed mt-2">
                It doesn't change a session you're both in — the draw and the scoreboard stay as they are.
                They are never told.
              </p>
              <ErrorNote error={error} where="SafetySheet.block" />
              <div className="mt-5 space-y-2.5">
                <button onClick={doBlock} disabled={busy} className={primary}>
                  {busy ? "Blocking…" : `Block ${displayName}`}
                </button>
                <button onClick={() => setMode("menu")} disabled={busy} className="w-full text-[13px] font-semibold text-warm-gray py-3 active:opacity-70">
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-serif text-[21px] font-medium text-graphite leading-tight">Report {displayName}</h2>
              <p className="text-[12.5px] text-warm-gray mt-1">What's wrong?</p>

              <div className="mt-3 space-y-1.5 max-h-[42vh] overflow-y-auto">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={`w-full text-left rounded-2xl border px-3.5 py-2.5 transition-colors ${
                      reason === r.value ? "border-graphite bg-surface" : "border-line bg-surface"
                    }`}
                  >
                    <span className="block text-[13.5px] font-semibold text-graphite">{r.label}</span>
                    <span className="block text-[12px] text-warm-gray mt-0.5 leading-snug">{r.hint}</span>
                  </button>
                ))}
              </div>

              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value.slice(0, 1000))}
                placeholder="Anything else we should know? (optional)"
                rows={3}
                className="w-full mt-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55 resize-none"
              />

              <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alsoBlock}
                  onChange={(e) => setAlsoBlock(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-graphite shrink-0"
                />
                <span className="text-[12.5px] text-ink-2 leading-snug">
                  Also block them, so you stop seeing their profile straight away
                </span>
              </label>

              <ErrorNote error={error} where="SafetySheet.report" />

              <div className="mt-4 space-y-2.5">
                <button onClick={submitReport} disabled={busy || !reason} className={primary}>
                  {busy ? "Sending…" : "Send report"}
                </button>
                <button onClick={() => setMode("menu")} disabled={busy} className="w-full text-[13px] font-semibold text-warm-gray py-3 active:opacity-70">
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
