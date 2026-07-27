import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInHost, signUpHost, resendConfirmation } from "../../lib/supabase/auth";

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

  async function handleResend() {
    if (!pendingEmail) return;
    setResend("sending");
    try {
      await resendConfirmation(pendingEmail);
      setResend("sent");
    } catch {
      setResend("idle");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const result = await signUpHost({ name, email, password });
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
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // ── Check-your-email screen (shown after a signup that needs confirmation) ──
  if (pendingEmail) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 flex flex-col">
        <div className="font-wordmark text-[22px] font-semibold text-graphite flex items-baseline leading-none mb-10">
          Padelier
          <span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
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
      {/* Brand header */}
      <div className="font-wordmark text-[22px] font-semibold text-graphite flex items-baseline leading-none mb-6">
        Padelier
        <span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
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
        <input
          className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
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
