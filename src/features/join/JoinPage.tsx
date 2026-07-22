import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resolveJoinCode } from "../../lib/supabase/joinQueries";

/**
 * Join-by-code screen (`/join`). Full Padelier code-entry UI; submit calls the
 * clearly-stubbed `resolveJoinCode` (see joinQueries.ts) which would navigate to
 * the read-only spectator view `/live/:publicToken`.
 *
 * BLOCKER (flagged): the `resolve_join_code` RPC does not exist yet and is a
 * product + security decision. Until it ships, submit surfaces a friendly,
 * honest message rather than erroring cryptically — no RLS-bypassing query is
 * attempted here.
 */
export default function JoinPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isComplete = code.length === 6;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isComplete) return;
    setSubmitting(true);
    setError(null);
    try {
      const publicToken = await resolveJoinCode(code);
      navigate(`/live/${publicToken}`);
    } catch {
      // The resolver RPC isn't live yet (see joinQueries.ts) — keep it honest.
      setError("Joining by code isn't switched on yet — ask your host for the watch link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
      {/* Wordmark header */}
      <div className="font-wordmark text-[22px] font-semibold text-graphite flex items-baseline leading-none mb-6">
        Padelier
        <span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">Join a session.</h1>
      <p className="text-[13.5px] text-ink-2 leading-relaxed mb-6">
        Enter the code your host shared to follow the action live.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          aria-label="6-digit join code"
          className="w-full rounded-2xl border border-line bg-surface px-4 py-4 text-center font-mono tnum text-[28px] tracking-[0.3em] text-graphite placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-graphite/15"
        />
        {error && <p className="text-[13px] text-loss">{error}</p>}
        <button
          type="submit"
          disabled={!isComplete || submitting}
          className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40"
        >
          {submitting ? "Finding session…" : "Watch session"}
        </button>
        <p className="text-[11px] text-warm-gray text-center">You only need the code — no account required to watch.</p>
      </form>
    </div>
  );
}
