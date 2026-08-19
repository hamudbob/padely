import { useState } from "react";
import { codeFor, describe, messageOf } from "../../lib/errors";
import { reportHandledError } from "../../lib/errorReporter";

/**
 * How a failure is shown to a person, everywhere in the app.
 *
 * Three things, in descending order of use to them:
 *
 *   1. what went wrong, in words
 *   2. a code they can quote — the whole point. "Could not load your
 *      sessions" cost two hours and a database audit; "PLR-2002" would have
 *      cost one message.
 *   3. a Report button that puts the code, the screen, the time and the
 *      browser on their clipboard and opens a message to support, so what
 *      arrives is a report rather than "it's broken again".
 *
 * The code is quiet by design. Someone who doesn't need it shouldn't have to
 * read past it, and someone who does needs it to be exact — so it's small,
 * monospaced, and copies on tap.
 */
export default function ErrorNote({
  error,
  where,
  fallback = "Something went wrong.",
  className = "",
}: {
  /** The caught value, not a string: the code is derived from it. */
  error: unknown;
  /** Screen or action — used to classify a failure that identifies itself
   *  poorly, and shown to you in the report. */
  where: string;
  fallback?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (error === null || error === undefined) return null;

  // A plain string is the app talking to the person — "Enter both teams'
  // scores" — not a failure. Guidance gets no reference number and no report
  // button; nobody needs a case file for typing nothing into a box.
  if (typeof error === "string") {
    return (
      <p className={`text-[13px] text-loss leading-relaxed ${className}`}>{error}</p>
    );
  }

  const code = codeFor(error, where);
  const message = messageOf(error, fallback);
  const entry = describe(code);

  const details = [
    `Padelier problem report`,
    `Code: ${code}`,
    entry ? `Meaning: ${entry.title}` : `Meaning: not yet catalogued`,
    `Message: ${message}`,
    `Screen: ${where}`,
    `Page: ${typeof location !== "undefined" ? location.pathname : "?"}`,
    `When: ${new Date().toISOString()}`,
    `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
  ].join("\n");

  async function report() {
    // Log it again from the user's own hand: an error they cared enough to
    // report should be marked as such, not left indistinguishable from the
    // hundreds nobody noticed.
    reportHandledError(error, where, { code, user_reported: true });
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard refused (Safari without a gesture, or a locked-down
         browser) — the mail below still carries everything */
    }
    const subject = encodeURIComponent(`Padelier problem ${code}`);
    const body = encodeURIComponent(`${details}\n\nWhat I was doing:\n`);
    window.location.href = `mailto:info@padelier.id?subject=${subject}&body=${body}`;
  }

  return (
    <div className={`rounded-2xl bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)] ${className}`}>
      <p className="text-[13.5px] text-loss font-semibold leading-relaxed">{message}</p>
      <div className="flex items-center justify-between gap-3 mt-1.5">
        <button
          onClick={() => {
            navigator.clipboard?.writeText(code).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              },
              () => undefined,
            );
          }}
          className="font-mono text-[11px] text-warm-gray tracking-[0.06em] active:opacity-60"
          aria-label={`Error code ${code}, tap to copy`}
        >
          {copied ? "copied ✓" : code}
        </button>
        <button
          onClick={report}
          className="text-[11.5px] font-semibold text-ink-2 border border-line rounded-full px-3 py-1.5 bg-ivory active:opacity-70"
        >
          Report this
        </button>
      </div>
    </div>
  );
}

/** The same code, inline, for places that already have their own error styling
 *  and only need the reference number appended. */
export function ErrorCode({ error, where }: { error: unknown; where: string }) {
  if (error === null || error === undefined) return null;
  return <span className="font-mono text-[11px] text-warm-gray ml-1.5">{codeFor(error, where)}</span>;
}
