import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInHost, signUpHost } from "../../lib/supabase/auth";

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
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const result = await signUpHost({ name, email, password });
        if (!result.session) {
          // Supabase project still requires email confirmation — signUp()
          // creates the user but does NOT log them in until they confirm.
          // Navigating away here would look like success while leaving them
          // with no active session (the "Auth session missing!" error shows
          // up later, at the worst possible moment — mid-wizard).
          setInfo("Account created — check your email to confirm it, then log in below.");
          setMode("login");
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
