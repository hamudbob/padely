import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getJoinSession } from "../../lib/supabase/playerJoinQueries";
import HelpDot from "../shell/HelpDot";

/**
 * The single "enter a code" gateway (`/watch` and `/join`, optionally
 * `?code=123456` from a QR). Resolving the code sends the visitor to the live
 * session view (standings + rounds), carrying the code as ?j= so that once
 * there they can watch, claim their spot, or join as a new player — all from
 * one place. Entering a code creates nothing on its own.
 */
export default function WatchPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(value: string) {
    setChecking(true);
    setError(null);
    try {
      const found = await getJoinSession(value);
      if (!found || !found.publicToken) {
        setError("No open session matches that code. Double-check with the host.");
        return;
      }
      navigate(`/live/${found.publicToken}?j=${value}`);
    } catch {
      setError("Couldn't check that code just now — please try again.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const fromLink = (params.get("code") ?? "").replace(/\D/g, "").slice(0, 6);
    if (fromLink.length === 6) {
      setCode(fromLink);
      void resolve(fromLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length === 6) void resolve(code);
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 anim-fade">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] shrink-0 active:scale-95 transition-transform"
        >
          ‹
        </button>
        <div className="font-wordmark text-[22px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier<span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
      </div>

      <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1] flex items-center gap-2">
        Enter a code.
        <HelpDot topic="join-code" label="How joining by code works" className="mt-[3px]" />
      </h1>
      <p className="text-[13.5px] text-ink-2 leading-relaxed mb-6">
        Pop in the session code your host shared — you'll see the live standings and rounds, and from there you can watch, claim your spot, or join as a new player.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          aria-label="6-digit code"
          className="w-full rounded-2xl border border-line bg-surface px-4 py-4 text-center font-mono tnum text-[28px] tracking-[0.3em] text-graphite placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-graphite/15"
        />
        {error && <p className="text-[13px] text-loss">{error}</p>}
        <button
          type="submit"
          disabled={code.length !== 6 || checking}
          className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40"
        >
          {checking ? "Finding…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
