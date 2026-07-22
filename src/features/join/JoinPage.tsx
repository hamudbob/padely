import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getJoinSession, requestJoin, lookupGuest, JoinSessionInfo } from "../../lib/supabase/playerJoinQueries";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  mix_mexicano: "Mix Mexicano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

type Stage = "code" | "form" | "done";

/**
 * Join a session as a PLAYER (`/join`, optionally `/join?code=123456` from a
 * QR). Flow: validate the code → capture name / left-right / gender / optional
 * email → submit a request the host confirms. A returning guest (same email)
 * is pre-filled. Nothing here writes to the roster directly — it only calls the
 * public request_join RPC (0005), so no account is required.
 */
export default function JoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [stage, setStage] = useState<Stage>("code");
  const [code, setCode] = useState("");
  const [session, setSession] = useState<JoinSessionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  const [side, setSide] = useState<"L" | "R">("R");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessionName, setSessionName] = useState("");

  // Prefill + auto-advance when arriving from a QR link (?code=).
  useEffect(() => {
    const fromQr = (params.get("code") ?? "").replace(/\D/g, "").slice(0, 6);
    if (fromQr.length === 6) {
      setCode(fromQr);
      void validateCode(fromQr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function validateCode(value: string) {
    setChecking(true);
    setError(null);
    try {
      const found = await getJoinSession(value);
      if (!found) {
        setError("No open session matches that code. Double-check with your host.");
        return;
      }
      setSession(found);
      setStage("form");
    } catch {
      setError("Couldn't check that code just now — please try again.");
    } finally {
      setChecking(false);
    }
  }

  function handleCodeSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length === 6) void validateCode(code);
  }

  // A returning guest: fill name/gender/side from their last join if we know
  // this email and the fields are still untouched.
  async function handleEmailBlur() {
    if (!email.trim()) return;
    try {
      const guest = await lookupGuest(email);
      if (!guest) return;
      if (!name.trim()) setName(guest.name);
      setGender(guest.gender);
      if (guest.preferredSide) setSide(guest.preferredSide);
    } catch {
      /* prefill is best-effort — ignore lookup failures */
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!session || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestJoin({
        code,
        name: name.trim(),
        gender,
        preferredSide: side,
        email: email.trim() || null,
      });
      setSessionName(result.sessionName);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your request — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 anim-fade">
      {/* Back + wordmark header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => (stage === "form" ? setStage("code") : navigate(-1))}
          aria-label="Back"
          className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] shrink-0 active:scale-95 transition-transform"
        >
          ‹
        </button>
        <div className="font-wordmark text-[22px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier
          <span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
      </div>

      {stage === "code" && (
        <>
          <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">Join a session.</h1>
          <p className="text-[13.5px] text-ink-2 leading-relaxed mb-6">
            Enter the code your host shared — or scan their QR — to get on court.
          </p>
          <form onSubmit={handleCodeSubmit} className="space-y-3">
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
              disabled={code.length !== 6 || checking}
              className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40"
            >
              {checking ? "Checking…" : "Continue"}
            </button>
            <p className="text-[11px] text-warm-gray text-center">No account needed — just your name to play.</p>
          </form>
        </>
      )}

      {stage === "form" && session && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">Joining</p>
          <h1 className="font-serif text-[26px] font-medium tracking-tight text-graphite leading-[1.1]">{session.name}</h1>
          <p className="text-[12.5px] text-warm-gray mb-6">{FORMAT_LABELS[session.format] ?? session.format}</p>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Your name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="e.g. Hamud"
                className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Side</label>
                <div className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
                  {(["L", "R"] as const).map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setSide(s)}
                      className={`flex-1 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors ${
                        side === s ? "bg-graphite text-ivory" : "text-ink-2 active:bg-surface-2"
                      }`}
                    >
                      {s === "L" ? "Left" : "Right"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Gender</label>
                <div className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
                  {(["M", "F"] as const).map((g) => (
                    <button
                      type="button"
                      key={g}
                      onClick={() => setGender(g)}
                      className={`flex-1 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors ${
                        gender === g ? "bg-graphite text-ivory" : "text-ink-2 active:bg-surface-2"
                      }`}
                    >
                      {g === "M" ? "Male" : "Female"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">
                Email <span className="text-warm-gray font-medium normal-case tracking-normal">· optional</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={handleEmailBlur}
                placeholder="you@email.com"
                className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
              />
              <p className="text-[11px] text-warm-gray mt-1.5">We'll remember your details next time — and your history is saved if you ever make an account.</p>
            </div>

            {error && <p className="text-[13px] text-loss">{error}</p>}
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40"
            >
              {submitting ? "Sending…" : "Ask to join"}
            </button>
          </form>
        </>
      )}

      {stage === "done" && (
        <div className="text-center pt-10 anim-rise">
          <div className="w-16 h-16 rounded-full bg-gold-soft text-gold-ink flex items-center justify-center mx-auto mb-5">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h1 className="font-serif text-[25px] font-medium tracking-tight text-graphite leading-[1.15]">You're on the list.</h1>
          <p className="text-[13.5px] text-ink-2 leading-relaxed mt-2">
            Your request to join <span className="font-semibold text-graphite">{sessionName}</span> is in — the host just needs to wave you
            in. Hang tight; you'll be on court soon.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-6 inline-flex items-center justify-center rounded-full px-5 py-2.5 font-semibold text-[13px] border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
