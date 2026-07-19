import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { signOutHost } from "../../lib/supabase/auth";
import { listHostSessions, HostSessionSummary } from "../../lib/supabase/hostSessionsQueries";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  mix_mexicano: "Mix Mexicano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

// A small consistent color per format, used as each session card's left
// accent bar — purely cosmetic, lets the host's eye scan the list by format
// without reading every label.
const FORMAT_ACCENTS: Record<string, string> = {
  americano: "border-l-accent",
  mexicano: "border-l-violet-400",
  mix_americano: "border-l-sky-400",
  mix_mexicano: "border-l-fuchsia-400",
  fixed_partner: "border-l-amber-400",
  team_sparring: "border-l-rose-400",
};

function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return `Today · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Matches padel_wireframe.html screen 1 (Home), plus "Your Sessions" so a
 * logged-in host can reopen a past session (live or ended) instead of only
 * ever starting a new one.
 */
export default function HomePage() {
  const { user } = useHostSession();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<HostSessionSummary[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!user) {
      setSessions(null);
      return;
    }
    setSessionsLoading(true);
    setSessionsError(null);
    listHostSessions()
      .then(setSessions)
      .catch((err) => setSessionsError(err instanceof Error ? err.message : "Could not load your sessions."))
      .finally(() => setSessionsLoading(false));
  }, [user]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutHost();
      navigate(0); // reload so every hook (useHostSession etc.) resets cleanly
    } finally {
      setSigningOut(false);
    }
  }

  const liveSessions = (sessions ?? []).filter((s) => s.status === "live");
  const pastSessions = (sessions ?? []).filter((s) => s.status !== "live");

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-gradient-to-b from-accent-soft/40 to-white px-4 py-8">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">🎾 Padel Session Manager</h1>
          <p className="text-xs text-slate-500 mt-1">Fair rotations, live scoring, real standings.</p>
        </div>
      </div>

      {user && (
        <div className="flex items-center justify-between mt-4 mb-2 rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
          <p className="text-[11px] text-slate-500 truncate">
            Signed in as <span className="font-semibold text-slate-700">{user.email}</span>
          </p>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="shrink-0 text-[10px] font-bold text-slate-500 disabled:opacity-50 ml-2"
          >
            {signingOut ? "…" : "Sign out"}
          </button>
        </div>
      )}

      <div className="space-y-2.5 mt-6">
        <Link
          to="/create"
          className="flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-bold text-white bg-gradient-to-br from-accent to-accent-dark shadow-lg shadow-accent/20"
        >
          <span className="text-lg leading-none">+</span> Create Session
        </Link>
        <Link
          to="/join"
          className="flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-bold border border-slate-300 bg-white text-slate-700"
        >
          Join by Code
        </Link>
        {!user && (
          <Link
            to="/login"
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold border border-dashed border-slate-300 text-slate-500"
          >
            Log in / Sign up
          </Link>
        )}
      </div>

      {user && (
        <div className="mt-9">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Your Sessions</p>
            {liveSessions.length > 0 && (
              <span className="text-[9px] font-bold rounded-full px-2 py-0.5 bg-accent-soft text-accent-dark">
                {liveSessions.length} live
              </span>
            )}
          </div>

          {sessionsLoading && !sessions && (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          )}
          {sessionsError && <p className="text-sm text-red-600">{sessionsError}</p>}

          {sessions && sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
              <p className="text-2xl mb-1">🏟️</p>
              <p className="text-sm text-slate-400">No sessions yet — create one above to get started.</p>
            </div>
          )}

          {sessions && sessions.length > 0 && (
            <div className="space-y-2">
              {[...liveSessions, ...pastSessions].map((s) => (
                <Link
                  key={s.id}
                  to={`/session/${s.id}/host`}
                  className={`block rounded-xl border border-slate-200 border-l-4 ${
                    FORMAT_ACCENTS[s.format] ?? "border-l-slate-300"
                  } bg-white px-3 py-2.5 shadow-sm`}
                >
                  <div className="flex justify-between items-center">
                    <b className="text-sm truncate">{s.name}</b>
                    <span
                      className={`shrink-0 ml-2 text-[9px] font-bold rounded-full px-2 py-0.5 ${
                        s.status === "live" ? "bg-accent-soft text-accent-dark" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {s.status === "live" ? "● LIVE" : s.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {FORMAT_LABELS[s.format] ?? s.format} · Code {s.joinCode} · {formatSessionDate(s.createdAt)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
