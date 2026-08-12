import { PasswordVerdict, STRENGTH_LABEL } from "../../lib/passwordPolicy";

/**
 * The requirement checklist that sits under the password field on signup and
 * reset.
 *
 * Two decisions worth keeping:
 *
 * 1. Rules only ever turn *green*, never red. Typing a password is a
 *    progressive act — going red at character three, when the person is
 *    obviously mid-word, reads as failure for something that isn't finished.
 *    The one exception is the "obvious password" rule, which turns amber the
 *    moment we can name the reason, because that one is a judgement the person
 *    can't make on their own.
 *
 * 2. The meter's four segments track the same four rules, so the bar and the
 *    list can never disagree. A meter that says "Strong" over an unmet
 *    requirement is worse than no meter at all.
 */
export default function PasswordStrength({ verdict, show }: { verdict: PasswordVerdict; show: boolean }) {
  const { rules, score, strength, weakReason, valid } = verdict;

  // Collapses to zero height when hidden, so the form doesn't jump on focus.
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
      style={{ gridTemplateRows: show ? "1fr" : "0fr", opacity: show ? 1 : 0 }}
      aria-hidden={!show}
    >
      <div className="overflow-hidden">
        <div className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3 mt-1">
          {/* ── Meter ─────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="flex gap-1 flex-1">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${
                    i < score ? BAR[strength] : "bg-stone"
                  }`}
                />
              ))}
            </div>
            <span
              className={`text-[10.5px] font-bold uppercase tracking-[0.1em] tabular-nums transition-colors duration-300 ${
                TEXT[strength]
              }`}
            >
              {STRENGTH_LABEL[strength]}
            </span>
          </div>

          {/* ── Rules ─────────────────────────────────────────────────────── */}
          <ul className="space-y-[5px]">
            {rules.map((rule) => {
              // Amber only for the "obvious password" rule, and only once we
              // actually have a reason to show — see the note above.
              const flagged = rule.id === "notCommon" && !rule.met && weakReason !== null;
              return (
                <li key={rule.id} className="flex items-start gap-2">
                  <Mark met={rule.met} flagged={flagged} />
                  <span
                    className={`text-[12px] leading-[1.45] transition-colors duration-200 ${
                      rule.met ? "text-ink-2" : flagged ? "text-gold-ink" : "text-warm-gray"
                    }`}
                  >
                    {rule.label}
                    {flagged && weakReason && (
                      <span className="block text-[11.5px] text-gold-ink/85 mt-0.5">{weakReason}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {valid && (
            <p className="text-[11.5px] text-win font-semibold mt-2.5 flex items-center gap-1.5 anim-fade">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Nice — that's a solid password.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The 18px status dot: empty ring → amber warning → green tick. */
function Mark({ met, flagged }: { met: boolean; flagged: boolean }) {
  const base = "w-[15px] h-[15px] rounded-full shrink-0 mt-[2px] flex items-center justify-center transition-all duration-300";
  if (met) {
    return (
      <span className={`${base} bg-win text-white scale-100`}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (flagged) {
    return (
      <span className={`${base} border-[1.5px] border-gold text-gold-ink`}>
        <span className="w-[3px] h-[3px] rounded-full bg-gold-ink" />
      </span>
    );
  }
  return <span className={`${base} border-[1.5px] border-stone`} />;
}

const BAR: Record<string, string> = {
  empty: "bg-stone",
  weak: "bg-loss",
  fair: "bg-gold",
  good: "bg-win/70",
  strong: "bg-win",
};

const TEXT: Record<string, string> = {
  empty: "text-warm-gray",
  weak: "text-loss",
  fair: "text-gold-ink",
  good: "text-win",
  strong: "text-win",
};
