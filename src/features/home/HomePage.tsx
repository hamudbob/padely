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

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return `Today · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Home / Sessions — first Padelier-branded screen. Same behaviour as before
 * (a logged-in host can reopen any past session, live or ended, not just start
 * a new one) restyled to the brand: ivory ground, Fraunces greeting, graphite
 * primary action, Court Lime reserved for what's live.
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
  const greeting = greetingFor(new Date());

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 safe-top safe-bottom anim-fade">
      {/* Wordmark + host avatar */}
      <div className="flex items-center justify-between mb-6">
        <div className="font-wordmark text-[22px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier
          <span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
        {user && (
          <div className="w-9 h-9 rounded-full bg-graphite text-ivory flex items-center justify-center text-sm font-semibold uppercase">
            {(user.email ?? "?").charAt(0)}
          </div>
        )}
      </div>

      {/* Hero */}
      <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1]">
        {user ? `${greeting}.` : "The art of a great game."}
      </h1>
      <p className="text-[13.5px] text-ink-2 mt-1.5 mb-6 leading-relaxed">
        {user
          ? liveSessions.length > 0
            ? `${liveSessions.length} session${liveSessions.length > 1 ? "s" : ""} running — everyone's getting a fair game.`
            : "Fair rotations, live scoring, real standings."
          : "Fair rotations. Real standings. Zero napkin math."}
      </p>

      {/* Signed-in chip */}
      {user && (
        <div className="flex items-center justify-between mb-6 rounded-2xl bg-surface border border-line px-3.5 py-2.5">
          <p className="text-[11px] text-warm-gray truncate">
            Signed in as <span className="font-semibold text-ink-2">{user.email}</span>
          </p>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="shrink-0 text-[11px] font-semibold text-ink-2 disabled:opacity-50 ml-2"
          >
            {signingOut ? "…" : "Sign out"}
          </button>
        </div>
      )}

      {/* Primary actions */}
      <div className="space-y-2.5">
        <Link
          to="/create"
          className="flex items-center justify-center gap-2 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          <span className="text-lg leading-none">+</span> Create session
        </Link>
        <Link
          to="/join"
          className="flex items-center justify-center rounded-full px-4 py-3.5 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform"
        >
          Join by code
        </Link>
        {!user && (
          <Link
            to="/login"
            className="flex items-center justify-center rounded-full px-4 py-3 font-semibold text-ink-2 border border-dashed border-stone"
          >
            Log in / Sign up
          </Link>
        )}
      </div>

      {/* Your sessions */}
      {user && (
        <div className="mt-9">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Your sessions</p>
            {liveSessions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold rounded-full px-2.5 py-1 bg-graphite text-ivory">
                <span className="w-1.5 h-1.5 rounded-full bg-court-lime" aria-hidden />
                {liveSessions.length} live
              </span>
            )}
          </div>

          {sessionsLoading && !sessions && (
            <div className="rounded-2xl border border-line bg-surface overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-t border-line first:border-t-0">
                  <span className="w-2 h-2 rounded-full skeleton shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-1/3 rounded skeleton" />
                    <div className="h-2.5 w-2/3 rounded skeleton" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {sessionsError && <p className="text-sm text-loss">{sessionsError}</p>}

          {sessions && sessions.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-8 text-center">
              <p className="text-sm text-warm-gray">No sessions yet — create one above to get started.</p>
            </div>
          )}

          {sessions && sessions.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
              {[...liveSessions, ...pastSessions].map((s) => (
                <Link
                  key={s.id}
                  to={`/session/${s.id}/host`}
                  className="anim-rise flex items-center gap-3 px-4 py-3.5 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      s.status === "live" ? "bg-court-lime shadow-[0_0_0_3px_rgba(196,226,75,0.28)]" : "bg-stone"
                    }`}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <b className="block text-[15px] font-semibold text-graphite truncate">{s.name}</b>
                    <p className="text-[11px] text-warm-gray mt-0.5 truncate">
                      {FORMAT_LABELS[s.format] ?? s.format} · Code <span className="font-mono tnum">{s.joinCode}</span> · {formatSessionDate(s.createdAt)}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
