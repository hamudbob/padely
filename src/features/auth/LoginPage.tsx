import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { signInHost, signUpHost, resendConfirmation, ensureHostTeamForCurrentUser, sendPasswordReset } from "../../lib/supabase/auth";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";
import PasswordField from "./PasswordField";

/** Only allow returning to an in-app path — never an absolute/external URL
 * (guards against an open-redirect via a crafted ?next=). */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

/**
 * Matches padel_wireframe.html screen 2. Real Supabase auth wiring (this one
 * is fully wired, not a stub) — host-only per the "minimal scope" decision;
 * players joining by code don't use this screen (see JoinPage).
 */
export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // When signup needs email confirmation we show a dedicated "check your email"
  // screen instead of silently bouncing to the login tab.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Forgot-password sub-flow. ?forgot=1 opens it directly, which is where the
  // expired-link screen sends people.
  const [forgot, setForgot] = useState(() => params.get("forgot") === "1");
  const [resetEmail, setResetEmail] = useState("");
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");
  // Where to land after a successful sign-in. Defaults home, but a shared link
  // (e.g. an event) sends the visitor here with ?next=/e/… so we return them to
  // exactly the page they were trying to open.
  const next = safeNext(params.get("next"));
  // Cancelling out of login returns to the previous page (the event/team they
  // came from), falling back to Home only when login was opened cold.
  const back = useBackNav("/");
  // The confirmation link lands the user back here (/login?next=…) with their
  // session established from the URL. When that session appears, finish the
  // team auto-creation and forward them to their intended destination.
  const { user } = useHostSession();
  const emailRedirectTo = `${window.location.origin}/login?next=${encodeURIComponent(next)}`;

  useEffect(() => {
    if (!user) return;
    // Don't bounce someone out of the forgot-password flow just because they
    // still have a live session (e.g. changing a password they half-remember).
    if (forgot) return;
    let cancelled = false;
    ensureHostTeamForCurrentUser()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) navigate(next, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [user, next, navigate, forgot]);

  async function handleResend() {
    if (!pendingEmail) return;
    setResend("sending");
    try {
      await resendConfirmation(pendingEmail, emailRedirectTo);
      setResend("sent");
    } catch {
      setResend("idle");
    }
  }

  async function handleSendReset(e: FormEvent) {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setResetState("sending");
    setError(null);
    try {
      await sendPasswordReset(resetEmail, `${window.location.origin}/reset-password`);
      setResetState("sent");
    } catch (err) {
      // Only real failures (rate limits) reach here — see sendPasswordReset.
      setError(err instanceof Error ? err.message : "Couldn't send the email just now.");
      setResetState("idle");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const result = await signUpHost({ name, email, password, redirectTo: emailRedirectTo });
        if (!result.session) {
          // Email confirmation required — signUp() created the user but did NOT
          // log them in. Show the dedicated "check your email" screen so they
          // know exactly what to do (and to look in spam), instead of a silent
          // bounce to the login tab that later fails mid-wizard.
          setPendingEmail(email);
          setLoading(false);
          return;
        }
      } else {
        await signInHost({ email, password });
      }
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // Shared top bar: back arrow (returns to the previous page) + the Padelier
  // wordmark, which itself links Home — so there's always both a "back" and a
  // "home" way out of the auth screens.
  const topBar = (
    <div className="flex items-center justify-between mb-8">
      <button
        onClick={back}
        aria-label="Back"
        className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
      >
        ‹
      </button>
      <Link to="/" aria-label="Home" className="font-wordmark text-[20px] font-semibold text-graphite flex items-baseline leading-none active:opacity-70">
        Padelier<span className="ml-[3px] w-[6px] h-[6px] rounded-full bg-gold inline-block" aria-hidden />
      </Link>
      <Link
        to="/"
        aria-label="Home"
        className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95 transition-transform"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      </Link>
    </div>
  );

  // ── Forgot-password screen ─────────────────────────────────────────────────
  if (forgot) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
        {topBar}
        {resetState === "sent" ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-gold-soft border border-line flex items-center justify-center mb-5">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </div>
            <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">Check your email</h1>
            <p className="text-[13.5px] text-ink-2 mt-3 leading-relaxed">
              If <span className="font-semibold text-graphite">{resetEmail.trim()}</span> has an account, a reset link is on its way.
              Open it and you'll be able to set a new password.
            </p>
            <p className="text-[13px] text-warm-gray mt-3 leading-relaxed">
              Nothing yet? Give it a minute and <span className="font-semibold text-ink-2">check spam</span> — these often land there.
            </p>
            <button
              type="button"
              onClick={() => {
                setForgot(false);
                setResetState("idle");
                setMode("login");
              }}
              className="w-full mt-7 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
            >
              Back to log in
            </button>
          </>
        ) : (
          <>
            <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">Forgot your password?</h1>
            <p className="text-[13.5px] text-ink-2 mt-2 mb-5 leading-relaxed">
              Pop in your email and we'll send you a link to set a new one.
            </p>
            <form onSubmit={handleSendReset} className="space-y-3">
              <input
                className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
                placeholder="Email"
                type="email"
                autoComplete="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
              />
              {error && <p className="text-[13px] text-loss">{error}</p>}
              <button
                type="submit"
                disabled={resetState === "sending" || !resetEmail.trim()}
                className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-50"
              >
                {resetState === "sending" ? "Sending…" : "Send reset link"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForgot(false);
                  setError(null);
                }}
                className="w-full text-[13.5px] font-semibold text-warm-gray py-3 active:opacity-70"
              >
                Back to log in
              </button>
            </form>
          </>
        )}
      </div>
    );
  }

  // ── Check-your-email screen (shown after a signup that needs confirmation) ──
  if (pendingEmail) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 flex flex-col">
        {topBar}
        <div className="w-14 h-14 rounded-2xl bg-gold-soft border border-line flex items-center justify-center mb-5">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </div>
        <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-[1.1]">Check your email</h1>
        <p className="text-[14px] text-ink-2 mt-3 leading-relaxed">
          We sent a confirmation link to <span className="font-semibold text-graphite">{pendingEmail}</span>. Open it to
          activate your account, then come back and log in.
        </p>
        <p className="text-[13px] text-warm-gray mt-3 leading-relaxed">
          Can't find it? Give it a minute, and <span className="font-semibold text-ink-2">check your spam / junk folder</span> —
          confirmation emails sometimes land there.
        </p>

        <div className="mt-auto pt-8 space-y-2.5">
          <button
            type="button"
            onClick={handleResend}
            disabled={resend !== "idle"}
            className="w-full rounded-full px-4 py-3.5 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform disabled:opacity-50"
          >
            {resend === "sending" ? "Sending…" : resend === "sent" ? "Sent again ✓" : "Resend email"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingEmail(null);
              setResend("idle");
              setMode("login");
              setInfo("Confirm your email, then log in here.");
            }}
            className="w-full rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
          >
            Back to log in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
      {topBar}
      <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">Welcome back.</h1>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-2 mb-5">Log in / Sign up</p>
      <div className="flex rounded-full bg-surface border border-line p-1 mb-4">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold ${mode === "login" ? "bg-graphite text-ivory" : "text-warm-gray"}`}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold ${mode === "signup" ? "bg-graphite text-ivory" : "text-warm-gray"}`}
        >
          Sign up
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === "signup" && (
          <input
            className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <PasswordField
          value={password}
          onChange={setPassword}
          placeholder="Password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          required
        />
        {mode === "login" && (
          <div className="flex justify-end -mt-1">
            <button
              type="button"
              onClick={() => {
                setForgot(true);
                setResetEmail(email);
                setError(null);
                setInfo(null);
              }}
              className="text-[12.5px] font-semibold text-gold-ink active:opacity-70"
            >
              Forgot password?
            </button>
          </div>
        )}
        {info && <p className="text-[13px] text-win">{info}</p>}
        {error && <p className="text-[13px] text-loss">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-50"
        >
          {loading ? "Please wait…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
