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
    <div className="mx-auto max-w-sm min-h-screen bg-white px-4 py-8">
      <h1 className="text-xl font-extrabold mb-4">Log in / Sign up</h1>
      <div className="flex bg-slate-100 rounded-xl p-1 mb-4">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 py-2 rounded-lg text-sm font-bold ${mode === "login" ? "bg-white shadow" : "text-slate-500"}`}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 py-2 rounded-lg text-sm font-bold ${mode === "signup" ? "bg-white shadow" : "text-slate-500"}`}
        >
          Sign up
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === "signup" && (
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        {info && <p className="text-sm text-accent-dark">{info}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl px-4 py-3 font-bold text-white bg-gradient-to-br from-accent to-accent-dark shadow disabled:opacity-50"
        >
          {loading ? "Please wait…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
