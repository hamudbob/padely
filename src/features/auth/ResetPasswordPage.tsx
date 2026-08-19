import { FormEvent, useEffect, useMemo, useState } from "react";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase/client";
import { updatePassword } from "../../lib/supabase/auth";
import { evaluatePassword } from "../../lib/passwordPolicy";
import PasswordField from "./PasswordField";
import PasswordStrength from "./PasswordStrength";

type Stage = "checking" | "ready" | "invalid" | "done";

/**
 * Where Supabase's "reset your password" email lands (`/reset-password`).
 *
 * The link carries a one-time recovery token. supabase-js consumes it from the
 * URL on load (detectSessionInUrl) and emits PASSWORD_RECOVERY, which gives us
 * a short-lived session that's allowed to call updateUser({ password }).
 *
 * We wait for that rather than assuming: landing here with no token (someone
 * bookmarked the page, or the link expired) has to show a real dead end instead
 * of a form that can't work. An expired link comes back as #error=... in the
 * hash, which we surface verbatim-ish rather than pretending it's fine.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  // Same rules as signup. The recovery session tells us whose account this is,
  // so the policy can also reject a password built from their own email.
  const verdict = useMemo(() => evaluatePassword(password, { email: email ?? undefined }), [password, email]);
  const showPolicy = pwFocused || password.length > 0;

  useEffect(() => {
    let settled = false;

    // An expired or already-used link arrives as an error in the hash.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashError = hash.get("error_description") || hash.get("error");
    if (hashError) {
      setError(hashError.replace(/\+/g, " "));
      setStage("invalid");
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && !settled)) {
        settled = true;
        setEmail(session?.user?.email ?? null);
        setStage("ready");
      }
    });

    // If the token was already exchanged before this component mounted, there's
    // a session waiting and no further event will fire — check directly too.
    supabase.auth.getSession().then(({ data }) => {
      if (settled) return;
      if (data.session) {
        settled = true;
        setEmail(data.session.user?.email ?? null);
        setStage("ready");
      } else {
        // Give detectSessionInUrl a moment to finish the exchange.
        setTimeout(() => {
          if (settled) return;
          settled = true;
          setStage("invalid");
        }, 2500);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!verdict.valid) {
      setPwFocused(true);
      setError("Please meet all the password requirements below.");
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await updatePassword(password);
      setStage("done");
    } catch (err) {
      setError(withFallback(err, "Couldn't update your password."));
    } finally {
      setSaving(false);
    }
  }

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 safe-top safe-bottom anim-fade";
  const wordmark = (
    <Link to="/" aria-label="Home" className="font-wordmark text-[22px] font-semibold text-graphite flex items-baseline leading-none mb-8 active:opacity-70">
      Padelier<span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
    </Link>
  );

  if (stage === "checking") {
    return (
      <div className={shell}>
        {wordmark}
        <p className="text-[13px] text-warm-gray mt-16 text-center">Checking your link…</p>
      </div>
    );
  }

  if (stage === "invalid") {
    return (
      <div className={shell}>
        {wordmark}
        <h1 className="font-serif text-[27px] font-semibold tracking-tight text-graphite leading-[1.1]">This link has expired</h1>
        <p className="text-[13.5px] text-ink-2 mt-3 leading-relaxed">
          Password links can only be used once, and they time out after a while. Ask for a fresh one and it'll work.
        </p>
        <ErrorNote error={error} where="ResetPasswordPage" className="mt-2" />
        <Link
          to="/login?forgot=1"
          className="flex items-center justify-center mt-7 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          Send a new link
        </Link>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className={shell}>
        {wordmark}
        <div className="w-14 h-14 rounded-2xl bg-win-soft flex items-center justify-center mb-5">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2E8B57" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="font-serif text-[27px] font-semibold tracking-tight text-graphite leading-[1.1]">Password updated</h1>
        <p className="text-[13.5px] text-ink-2 mt-3 leading-relaxed">
          You're signed in with your new password. It'll be needed next time you log in.
        </p>
        <button
          onClick={() => navigate("/", { replace: true })}
          className="w-full mt-7 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          Go to Padelier
        </button>
      </div>
    );
  }

  return (
    <div className={shell}>
      {wordmark}
      <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">Set a new password</h1>
      <p className="text-[13.5px] text-ink-2 mt-2 mb-5 leading-relaxed">Pick something you'll remember, and that nobody else would guess.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <PasswordField
          value={password}
          onChange={setPassword}
          placeholder="New password"
          autoComplete="new-password"
          minLength={8}
          required
          onFocus={() => setPwFocused(true)}
          onBlur={() => setPwFocused(false)}
          describedBy="password-policy"
        />
        <div id="password-policy" aria-live="polite">
          <PasswordStrength verdict={verdict} show={showPolicy} />
        </div>
        <PasswordField
          value={confirm}
          onChange={setConfirm}
          placeholder="Repeat new password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {confirm.length > 0 && password !== confirm && (
          <p className="text-[12px] text-warm-gray -mt-1">Those two don't match yet.</p>
        )}
        <ErrorNote error={error} where="ResetPasswordPage" />
        <button
          type="submit"
          disabled={saving || !verdict.valid || password !== confirm}
          className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
