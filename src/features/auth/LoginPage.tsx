import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  signInHost,
  InvalidCredentialsError,
  signUpAndClassify,
  resendConfirmation,
  ensureHostTeamForCurrentUser,
  sendPasswordReset,
  emailHasAccount,
  signInWithGoogle,
} from "../../lib/supabase/auth";
import { getMyProfile } from "../../lib/supabase/profileQueries";
import { useAppSettings } from "../../lib/supabase/appSettings";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";
import { evaluatePassword } from "../../lib/passwordPolicy";
import { checkEmailShape, checkEmailDomain, domainVerdictError } from "../../lib/emailValidation";
import PasswordField from "./PasswordField";
import PasswordStrength from "./PasswordStrength";

/** Only allow returning to an in-app path — never an absolute/external URL
 * (guards against an open-redirect via a crafted ?next=). */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

/**
 * Unified email-first sign-in / sign-up.
 *
 * One field to start. On Continue we ask whether that address already has an
 * account (email_exists, 0035) and the SAME screen becomes the right form —
 * no tabs to choose between, no second route, and nobody has to know in advance
 * whether they're a returning player or a new one.
 *
 *   email ──► signin   (password + "Forgot password?")
 *         ├─► signup   (password + strength meter)
 *         ├─► pending  (account exists but was never confirmed → resend)
 *         └─► sent     (new signup, confirmation mail on its way)
 *
 * `unknown` is the important branch: if the lookup is rate-limited or offline we
 * must NOT assume "no account". Instead we ask for a password without claiming
 * which mode it is, try to sign in, and only fall back to signing up if that
 * genuinely fails — so a returning user is never pushed into a doomed sign-up.
 */
type Stage = "email" | "signin" | "signup" | "unknown" | "pending" | "sent" | "forgot";

export default function LoginPage() {
  // Read ?forgot=1 once, at mount. Doing this in an effect keyed on the search
  // params would fight the user: useSearchParams hands back a fresh object each
  // render, so leaving the reset flow would immediately snap back into it while
  // ?forgot=1 was still in the URL.
  const [stage, setStage] = useState<Stage>(() =>
    new URLSearchParams(window.location.search).get("forgot") === "1" ? "forgot" : "email",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<unknown>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");
  // Set only on the fallback path, where we genuinely can't tell whether the
  // address has an account — it offers the sign-up door without ever guessing.
  const [offerSignup, setOfferSignup] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");
  const [googleBusy, setGoogleBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement | null>(null);

  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const back = useBackNav("/");
  const { user } = useHostSession();
  const emailRedirectTo = `${window.location.origin}/login?next=${encodeURIComponent(next)}`;

  const verdict = useMemo(() => evaluatePassword(password, { email }), [password, email]);
  const isSignup = stage === "signup";
  // A pause set from the admin console. Enforced HERE, not in the database:
  // it closes the ordinary front door, and is not a lock. Said plainly in the
  // admin UI too, so nobody mistakes it for security.
  const { signupsPaused } = useAppSettings();
  const showPolicy = isSignup && (pwFocused || password.length > 0);

  // The confirmation link lands back here with a session already established.
  // Finish team setup, then send them on.
  //
  // The onboarding check has to happen HERE as well as in RequireHost, because
  // `next` is usually "/" — and Home is a public page with no guard on it. A
  // brand-new account would otherwise sail straight past /welcome and end up
  // named after the front of their email address.
  useEffect(() => {
    if (!user || stage === "forgot") return;
    let cancelled = false;
    (async () => {
      await ensureHostTeamForCurrentUser().catch(() => undefined);
      let target = next;
      try {
        const profile = await getMyProfile();
        if (profile?.needsOnboarding) {
          target = `/welcome?next=${encodeURIComponent(next)}`;
        }
      } catch {
        // Can't tell — send them to the app rather than trapping them here.
      }
      if (!cancelled) navigate(target, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, next, navigate, stage]);

  /** Leave for Google's consent screen. On success this navigates away and
   *  nothing below it runs; we only ever land back here on failure, so the
   *  busy flag is cleared in the catch rather than a finally. */
  async function handleGoogle() {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle(`${window.location.origin}/login?next=${encodeURIComponent(next)}`);
    } catch (err) {
      setGoogleBusy(false);
      setError(withFallback(err, "Couldn't reach Google just now. Try your email instead."));
    }
  }

  /** Move to a password stage and put the cursor in the field. */
  function goToPassword(target: Stage) {
    setStage(target);
    setError(null);
    requestAnimationFrame(() => pwRef.current?.focus());
  }

  // ── Step 1: the email ──────────────────────────────────────────────────────
  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const shape = checkEmailShape(email);
    setEmail(shape.normalised); // trimmed + lowercased from here on
    if (shape.error) {
      setEmailError(shape.error);
      setSuggestion(null);
      return;
    }
    // A likely typo is offered, not enforced — pressing Continue again accepts
    // what they typed, so nobody is trapped by a wrong guess.
    if (shape.suggestion && shape.suggestion !== suggestion) {
      setSuggestion(shape.suggestion);
      setEmailError(null);
      return;
    }
    setEmailError(null);
    setSuggestion(null);
    setLoading(true);

    try {
      // Deliverability and existence in parallel — one is a DNS round trip, the
      // other a database call, and neither depends on the other.
      const [verdictDomain, account] = await Promise.all([
        checkEmailDomain(shape.normalised),
        emailHasAccount(shape.normalised),
      ]);

      // Only block on a dead domain for a NEW account. A domain that has since
      // lapsed must never lock an existing user out of their own account.
      const domainProblem = domainVerdictError(verdictDomain);
      if (domainProblem && account?.exists !== true) {
        setEmailError(domainProblem);
        return;
      }

      if (account === null) {
        // Lookup unavailable — ask for a password without claiming which this is.
        goToPassword("unknown");
      } else if (!account.exists) {
        goToPassword("signup");
      } else if (!account.confirmed) {
        // The account exists but the link was never clicked. Offering a password
        // here would just fail; offering a resend is what they actually need.
        setStage("pending");
      } else {
        goToPassword("signin");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: the password ───────────────────────────────────────────────────
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (isSignup && !verdict.valid) {
      setPwFocused(true);
      setError("Please meet all the password requirements below.");
      return;
    }
    setLoading(true);
    try {
      if (stage === "signin") {
        await signInHost({ email, password });
        navigate(next);
        return;
      }

      if (stage === "unknown") {
        // Try the returning-user path first: it's non-destructive, and a success
        // means we never needed the lookup at all.
        try {
          await signInHost({ email, password });
          navigate(next);
          return;
        } catch (signInErr) {
          // Anything that isn't a credential rejection is a real error and must
          // be shown as one — never quietly reinterpreted as "no such account".
          if (!(signInErr instanceof InvalidCredentialsError)) throw signInErr;

          // The password was wrong, OR there's no account — Supabase gives the
          // same answer for both, on purpose.
          //
          // We deliberately do NOT try to settle it by calling signUp with the
          // password they just typed. That's what produced the nonsense where
          // someone logging in with a mistyped password was told their password
          // was "known to be easy" — a leaked-password rejection from a sign-up
          // they never asked for. Creating an account is now always something
          // the person chooses, and it goes through the sign-up form with the
          // strength meter attached.
          setStage("signin");
          setOfferSignup(true);
          setError("That password didn't work. Try again, reset it below — or create an account if you're new here.");
          return;
        }
      }

      // stage === "signup"
      if (signupsPaused) {
        setError("New accounts are paused just now. If you already have one, sign in above — nothing has changed for existing accounts.");
        return;
      }
      const out = await signUpAndClassify({ email, password, redirectTo: emailRedirectTo });
      if (out.alreadyRegistered) {
        // The lookup said "new" but Supabase says otherwise — e.g. they signed
        // up in another tab a moment ago. Send them to sign-in with what they
        // already typed rather than showing a mail that will never arrive.
        setStage("signin");
        setError("You already have an account with this email — sign in instead.");
        return;
      }
      if (out.needsConfirmation) setStage("sent");
      else navigate(next);
    } catch (err) {
      setError(withFallback(err, "Something went wrong."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResend("sending");
    setError(null);
    try {
      await resendConfirmation(email, emailRedirectTo);
      setResend("sent");
    } catch (err) {
      // Surfaced rather than swallowed — a silent reset to "Resend email" looks
      // like the button is broken when it's really just a rate limit.
      setResend("idle");
      setError(withFallback(err, "Couldn't resend just now — give it a minute."));
    }
  }

  async function handleSendReset(e: FormEvent) {
    e.preventDefault();
    const shape = checkEmailShape(email);
    if (shape.error) {
      setEmailError(shape.error);
      return;
    }
    setEmailError(null);
    setResetState("sending");
    setError(null);
    try {
      await sendPasswordReset(shape.normalised, `${window.location.origin}/reset-password`);
      setResetState("sent");
    } catch (err) {
      setError(withFallback(err, "Couldn't send the email just now."));
      setResetState("idle");
    }
  }

  /** Back to a bare email field — the escape hatch from every dead end. */
  function startOver(keepEmail = true) {
    setStage("email");
    setPassword("");
    setError(null);
    setInfo(null);
    setEmailError(null);
    setSuggestion(null);
    setResend("idle");
    setResetState("idle");
    setOfferSignup(false);
    if (!keepEmail) setEmail("");
  }

  // ── Chrome ────────────────────────────────────────────────────────────────
  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 safe-top safe-bottom";

  const topBar = (
    <div className="flex items-center justify-between mb-8">
      <button
        onClick={stage === "email" ? back : () => startOver()}
        aria-label={stage === "email" ? "Back" : "Change email"}
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

  const mailIcon = (
    <div className="w-14 h-14 rounded-2xl bg-gold-soft border border-line flex items-center justify-center mb-5">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    </div>
  );

  const primaryBtn =
    "w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40 disabled:active:scale-100";
  const quietBtn =
    "w-full rounded-full px-4 py-3.5 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform disabled:opacity-40";
  // Google's brand guidance: their mark on a plain surface, never recoloured
  // and never inside our filled graphite pill.
  const googleBtn =
    "w-full flex items-center justify-center gap-2.5 rounded-full px-4 py-3.5 font-semibold text-ink border border-line bg-surface active:scale-[0.99] transition-transform disabled:opacity-40 disabled:active:scale-100";
  const inputCls =
    "w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55";

  /** The confirmed email, shown as a quiet row with a way to change it. */
  const emailRow = (
    <button
      type="button"
      onClick={() => startOver()}
      className="w-full flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5 mb-3 text-left active:scale-[0.995] transition-transform"
    >
      <span className="text-[13.5px] text-ink-2 truncate">{email}</span>
      <span className="text-[12px] font-semibold text-gold-ink shrink-0">Change</span>
    </button>
  );

  // ── Forgot password ───────────────────────────────────────────────────────
  if (stage === "forgot") {
    return (
      <div className={`${shell} anim-fade`}>
        {topBar}
        {resetState === "sent" ? (
          <>
            {mailIcon}
            <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">Check your email</h1>
            <p className="text-[13.5px] text-ink-2 mt-3 leading-relaxed">
              If <span className="font-semibold text-graphite">{email}</span> has an account, a reset link is on its way.
              Open it and you'll be able to set a new password.
            </p>
            <p className="text-[13px] text-warm-gray mt-3 leading-relaxed">
              Nothing yet? Give it a minute and <span className="font-semibold text-ink-2">check spam</span> — these often land there.
            </p>
            <button type="button" onClick={() => startOver()} className={`${primaryBtn} mt-7`}>
              Back to sign in
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
                className={inputCls}
                placeholder="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(null);
                }}
                required
              />
              <ErrorNote error={emailError} where="LoginPage.email" />
              <ErrorNote error={error} where="LoginPage" />
              <button type="submit" disabled={resetState === "sending" || !email.trim()} className={primaryBtn}>
                {resetState === "sending" ? "Sending…" : "Send reset link"}
              </button>
              <button
                type="button"
                onClick={() => startOver()}
                className="w-full text-[13.5px] font-semibold text-warm-gray py-3 active:opacity-70"
              >
                Back to sign in
              </button>
            </form>
          </>
        )}
      </div>
    );
  }

  // ── Confirmation sent (new signup) ────────────────────────────────────────
  if (stage === "sent" || stage === "pending") {
    const isPending = stage === "pending";
    return (
      <div className={`${shell} flex flex-col anim-fade`}>
        {topBar}
        {mailIcon}
        <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-[1.1]">
          {isPending ? "You've nearly got an account" : "Check your email"}
        </h1>
        <p className="text-[14px] text-ink-2 mt-3 leading-relaxed">
          {isPending ? (
            <>
              There's already an account for <span className="font-semibold text-graphite">{email}</span>, but the
              confirmation link was never opened. Send yourself a fresh one and you're in.
            </>
          ) : (
            <>
              We sent a confirmation link to <span className="font-semibold text-graphite">{email}</span>. Open it to
              activate your account — you'll set your name and photo straight after.
            </>
          )}
        </p>
        <p className="text-[13px] text-warm-gray mt-3 leading-relaxed">
          Can't find it? Give it a minute, and <span className="font-semibold text-ink-2">check your spam / junk folder</span> —
          these sometimes land there.
        </p>
        <ErrorNote error={error} where="LoginPage" className="mt-2" />

        <div className="mt-auto pt-8 space-y-2.5">
          <button type="button" onClick={handleResend} disabled={resend !== "idle"} className={quietBtn}>
            {resend === "sending" ? "Sending…" : resend === "sent" ? "Sent again ✓" : "Resend email"}
          </button>
          {/* The way out of a typo'd address — without this, the only options
              are resending to the wrong inbox or giving up entirely. */}
          <button type="button" onClick={() => startOver(false)} className={primaryBtn}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  // ── Email, then password — same screen ────────────────────────────────────
  const onEmailStage = stage === "email";

  const heading = onEmailStage
    ? "Welcome to Padelier."
    : stage === "signin"
      ? "Welcome back."
      : stage === "signup"
        ? "Let's get you on court."
        : "One more step.";

  const subheading = onEmailStage
    ? "Sign in or create an account"
    : stage === "signin"
      ? "Enter your password"
      : stage === "signup"
        ? "Create a password"
        : "Enter your password";

  return (
    <div className={shell}>
      {topBar}
      <h1 key={heading} className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1] anim-fade">
        {heading}
      </h1>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-2 mb-5">{subheading}</p>

      {onEmailStage ? (
        <form onSubmit={handleEmailSubmit} className="space-y-3">
          <input
            className={inputCls}
            placeholder="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
              setSuggestion(null);
            }}
            required
          />
          <ErrorNote error={emailError} where="LoginPage.email" />

          {suggestion && (
            <div className="rounded-2xl border border-gold/40 bg-gold-soft/50 px-3.5 py-3 anim-fade">
              <p className="text-[12.5px] text-ink-2">
                Did you mean{" "}
                <button
                  type="button"
                  onClick={() => {
                    setEmail(suggestion);
                    setSuggestion(null);
                  }}
                  className="font-semibold text-gold-ink underline underline-offset-2 active:opacity-70"
                >
                  {suggestion}
                </button>
                ?
              </p>
              <p className="text-[11.5px] text-warm-gray mt-1">Or press Continue to keep what you typed.</p>
            </div>
          )}

          <button type="submit" disabled={loading || !email.trim()} className={primaryBtn}>
            {loading ? "Checking…" : "Continue"}
          </button>

          {/* Google sits BELOW the email field, not above it. Padelier's own
              accounts are the main road — most players arrive from a shared
              session link with an address the host already typed for them —
              and a provider button on top makes the ordinary path look like
              the fallback. It stays visible while signups are paused: the
              pause closes the front door, it is not a lock (see the note on
              signupsPaused above), and hiding it would shut existing Google
              users out of accounts they already have. */}
          <div className="flex items-center gap-3 pt-1" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <button type="button" onClick={handleGoogle} disabled={googleBusy} className={googleBtn}>
            <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden className="shrink-0">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
            </svg>
            {googleBusy ? "Taking you to Google…" : "Continue with Google"}
          </button>
        </form>
      ) : (
        <form onSubmit={handlePasswordSubmit} className="space-y-3">
          {emailRow}
          <PasswordField
            ref={pwRef}
            value={password}
            onChange={setPassword}
            placeholder={isSignup ? "Create a password" : "Password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={8}
            required
            onFocus={() => setPwFocused(true)}
            onBlur={() => setPwFocused(false)}
            describedBy={isSignup ? "password-policy" : undefined}
          />

          {isSignup && (
            <div id="password-policy" aria-live="polite">
              <PasswordStrength verdict={verdict} show={showPolicy} />
            </div>
          )}

          {/* Only offered where it makes sense: there's nothing to reset on a
              brand-new account. */}
          {stage !== "signup" && (
            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={() => {
                  setStage("forgot");
                  setError(null);
                  setResetState("idle");
                }}
                className="text-[12.5px] font-semibold text-gold-ink active:opacity-70"
              >
                Forgot password?
              </button>
            </div>
          )}

          {info && <p className="text-[13px] text-win">{info}</p>}
          <ErrorNote error={error} where="LoginPage" />

          <button
            type="submit"
            disabled={loading || !password || (isSignup && !verdict.valid)}
            className={primaryBtn}
          >
            {loading ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </button>

          {/* Only on the sign-up branch: consent has to be given before the
              account exists, and telling someone signing IN that they "agree"
              by signing in is the pattern these documents are meant to avoid.
              Under the button, not above it — it describes what the button
              does, and reads as a footnote rather than a wall to clear. */}
          {isSignup && (
            <p className="text-[11.5px] leading-relaxed text-warm-gray text-center">
              By creating an account you agree to our{" "}
              <Link to="/terms" className="font-semibold text-gold-ink">Terms of use</Link> and{" "}
              <Link to="/privacy" className="font-semibold text-gold-ink">Privacy policy</Link>. You
              must be 18 or over.
            </p>
          )}

          {offerSignup && stage === "signin" && (
            <button
              type="button"
              onClick={() => {
                setOfferSignup(false);
                setPassword("");
                goToPassword("signup");
              }}
              className="w-full text-[13px] font-semibold text-warm-gray py-2.5 active:opacity-70"
            >
              New here? Create an account instead
            </button>
          )}
        </form>
      )}
    </div>
  );
}
