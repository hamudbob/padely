import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getHostHomeSummary, HostHomeSession, HostHomeStats } from "../../lib/supabase/hostHomeQueries";
import { getResumableLobbies, sweepStaleDrafts, deleteSession, ResumableLobby } from "../../lib/supabase/sessionActions";
import { getProfile } from "../../lib/supabase/profileQueries";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  side_americano: "Fixed Position",
  mix_mexicano: "Mix Mexicano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

const STEPS = [
  { n: "01", t: "Create", s: "Name it, pick a format, add players." },
  { n: "02", t: "Play", s: "The app draws fair rounds; tap to score." },
  { n: "03", t: "Rank", s: "A live leaderboard, right to the last game." },
];

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// "Monday · 27 Jul"
function dateKicker(date: Date): string {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${weekday} · ${day}`;
}

function firstNameOf(user: { user_metadata?: { name?: unknown }; email?: string } | null): string {
  const name = (user?.user_metadata?.name as string | undefined)?.trim();
  if (name) return name.split(/\s+/)[0];
  return (user?.email || "").split("@")[0] || "there";
}

function initialsOf(user: { user_metadata?: { name?: unknown }; email?: string } | null): string {
  const name = (user?.user_metadata?.name as string | undefined)?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    const a = parts[0]?.[0] ?? "";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (a + b).toUpperCase() || "?";
  }
  return (user?.email || "?").charAt(0).toUpperCase();
}

// "15 JUL"
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
}

// "1st" / "2nd" / "3rd" / "4th"…
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Home — three states, rebuilt on the Apple-clean editorial system (warm ivory,
 * hairline-bordered cards, Fraunces serif, restrained gold) shared with the
 * team / profile / event pages:
 *   A. Logged-out landing — hero + Join/Watch (no hosting until sign-in)
 *   B. Logged-in, no sessions — create card + Join/Watch + how-it-works
 *   C. Logged-in, has sessions — greeting + stat strip + light live card +
 *      quick actions + session history with finishing place
 */
export default function HomePage() {
  const { user } = useHostSession();
  const [sessions, setSessions] = useState<HostHomeSession[] | null>(null);
  const [stats, setStats] = useState<HostHomeStats | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [resumable, setResumable] = useState<ResumableLobby[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // Abandoned setups used to sit here until the 10-day sweep collected them,
  // with no way to clear one by hand — drafts are deliberately hidden from the
  // profile's session list, so this card was their only appearance.
  const [discarding, setDiscarding] = useState<string | null>(null);

  async function discardDraft(lobby: ResumableLobby) {
    const label = lobby.name?.trim() || "this setup";
    if (!confirm(`Discard ${label}? The roster you'd started and its join code are gone for good.`)) return;
    setDiscarding(lobby.sessionId);
    setSessionsError(null);
    try {
      await deleteSession(lobby.sessionId);
      setResumable((prev) => prev.filter((l) => l.sessionId !== lobby.sessionId));
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : "Couldn't discard that setup.");
    } finally {
      setDiscarding(null);
    }
  }

  useEffect(() => {
    if (!user) {
      setSessions(null);
      setStats(null);
      setResumable([]);
      setAvatarUrl(null);
      return;
    }
    // Profile picture for the top-right chip (falls back to initials if unset).
    getProfile(user.id)
      .then((p) => setAvatarUrl(p?.avatarUrl ?? null))
      .catch(() => setAvatarUrl(null));
    setSessionsLoading(true);
    setSessionsError(null);
    getHostHomeSummary()
      .then((summary) => {
        setSessions(summary.sessions);
        setStats(summary.stats);
      })
      .catch((err) => setSessionsError(err instanceof Error ? err.message : "Could not load your sessions."))
      .finally(() => setSessionsLoading(false));
    sweepStaleDrafts(10)
      .catch(() => 0)
      .then(() => getResumableLobbies())
      .then(setResumable)
      .catch(() => setResumable([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const liveSessions = (sessions ?? []).filter((s) => s.status === "live");
  const pastSessions = (sessions ?? []).filter((s) => s.status !== "live");
  const now = new Date();
  const greeting = greetingFor(now);
  const hasAny = liveSessions.length > 0 || pastSessions.length > 0;

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory flex flex-col safe-top safe-bottom anim-fade";

  /* ── App bar ─────────────────────────────────────────── */
  const appBar = (
    <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
      <span className="font-wordmark text-[21px] font-semibold text-ink flex items-baseline leading-none">
        Padelier
        <span className="ml-[3px] w-[6px] h-[6px] rounded-full bg-gold inline-block" aria-hidden />
      </span>
      {user ? (
        <Link
          to="/profile"
          aria-label="Your dashboard"
          className="w-9 h-9 rounded-full bg-gold-soft border border-line flex items-center justify-center font-mono text-sm font-semibold text-gold-ink overflow-hidden active:scale-95 transition-transform"
        >
          {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : initialsOf(user)}
        </Link>
      ) : (
        <Link
          to="/login"
          className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-2 active:scale-95 transition-transform"
        >
          Log in
        </Link>
      )}
    </div>
  );

  /* ── STATE A: Logged-out landing ─────────────────────── */
  if (!user) {
    return (
      <div className={shell}>
        {appBar}
        <div className="flex-1 flex flex-col">
          {/* Hero */}
          <div className="px-5 pt-6 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-ink mb-3.5">Padel, run right</p>
            <h1 className="font-serif text-[40px] font-medium leading-[1.03] tracking-[-0.01em] text-ink text-balance">
              The art of a great game.
            </h1>
            <p className="text-[14px] leading-relaxed text-ink-2 mt-4 max-w-[300px]">
              Fair rounds, one-tap scores, a live leaderboard — from the first serve to the final table.
            </p>
          </div>

          {/* Jump in */}
          <div className="px-5 pt-7">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2.5 px-0.5">Jump in</p>
            <JumpInCard />
          </div>

          <div className="h-px bg-line mx-6 mt-8" />

          {/* How it works */}
          <div className="px-6 pt-6">
            <HowItWorks />
          </div>

          <div className="flex-1 min-h-[20px]" />
          <p className="text-[12px] leading-[1.5] text-warm-gray text-center px-6 py-7">
            Want to host your own games?{" "}
            <Link to="/login" className="font-semibold text-gold-ink">Log in or sign up</Link>.
          </p>
        </div>
      </div>
    );
  }

  /* ── Logged-in header (greeting) ─────────────────────── */
  const firstName = firstNameOf(user);
  const statusLine =
    liveSessions.length > 0
      ? `${liveSessions.length === 1 ? "One session" : `${liveSessions.length} sessions`} live now — pick up where you left off.`
      : hasAny
        ? "No session running — start a fresh draw when you're ready."
        : "Let's set up your first session — a fair draw is seconds away.";

  return (
    <div className={shell}>
      {appBar}

      <div className="flex-1 flex flex-col">
        <div className="px-5 pt-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-gold-ink mb-2">{dateKicker(now)}</p>
          <h1 className="font-serif text-[30px] font-medium leading-[1.05] tracking-[-0.01em] text-ink">
            {greeting}, {firstName}.
          </h1>
          {sessions && <p className="text-sm leading-relaxed text-warm-gray mt-2">{statusLine}</p>}
        </div>

        {/* Stat strip */}
        {stats && hasAny && (
          <div className="flex gap-2.5 px-5 pt-[18px]">
            {[
              { n: String(stats.sessionsHosted), l: "Sessions hosted" },
              { n: String(stats.activeThisMonth), l: "This month" },
              { n: String(stats.gamesPlayed), l: "Games played" },
            ].map((st) => (
              <div key={st.l} className="flex-1 bg-surface border border-line rounded-2xl px-3.5 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
                <div className="font-mono tnum font-bold text-[22px] text-ink leading-none">{st.n}</div>
                <div className="text-[11px] text-warm-gray mt-1.5 leading-tight">{st.l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Resume setup */}
        {resumable.length > 0 && (
          <div className="px-5 pt-4 flex flex-col gap-2.5">
            {resumable.map((l) => (
              <div
                key={l.sessionId}
                className={`anim-rise relative rounded-2xl border-[1.5px] border-dashed border-[#D8C79A] bg-gold-soft/50 transition-opacity ${
                  discarding === l.sessionId ? "opacity-40" : ""
                }`}
              >
                <Link
                  to={`/create?resume=${l.sessionId}`}
                  className="block px-[18px] py-4 pr-[46px] active:scale-[0.99] transition-transform"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-ink">Resume setup</p>
                    <p className="font-serif font-semibold text-[17px] text-ink truncate mt-0.5">{l.name || "Untitled session"}</p>
                    <p className="text-[12px] text-warm-gray mt-0.5">
                      {l.playerCount} {l.playerCount === 1 ? "player" : "players"} waiting · code <span className="font-mono">{l.joinCode}</span>
                    </p>
                  </div>
                  <span className="absolute right-[18px] bottom-4 text-gold-ink text-[18px]" aria-hidden>›</span>
                </Link>
                <button
                  onClick={() => discardDraft(l)}
                  disabled={discarding === l.sessionId}
                  aria-label={`Discard ${l.name || "this setup"}`}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full text-warm-gray flex items-center justify-center text-[15px] leading-none active:bg-gold/15 transition-colors disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Loading */}
        {sessionsLoading && !sessions && (
          <div className="px-5 pt-5 flex flex-col gap-2.5">
            <div className="h-[130px] rounded-2xl skeleton" />
            <div className="h-[68px] rounded-2xl skeleton" />
            <div className="h-[68px] rounded-2xl skeleton" />
          </div>
        )}
        {sessionsError && <p className="text-sm text-loss px-6 pt-4">{sessionsError}</p>}

        {/* ── STATE B: Logged-in, no sessions ──────────────── */}
        {sessions && !hasAny && (
          <div className="flex-1 flex flex-col px-5">
            {/* Create card (primary) */}
            <Link
              to="/create"
              className="mt-6 block rounded-3xl bg-surface border border-line px-5 py-6 shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:scale-[0.99] transition-transform"
            >
              <span className="w-[46px] h-[46px] rounded-2xl bg-graphite flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BFA36A" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <div className="font-serif font-semibold text-xl text-graphite">Create a session</div>
              <div className="text-[13.5px] leading-[1.5] text-ink-2 mt-1.5 max-w-[260px]">
                Name it, pick a play &amp; scoring format, add players. We'll handle the rounds.
              </div>
              <div className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold-ink">
                Start setup <span aria-hidden>›</span>
              </div>
            </Link>

            {/* Join / Watch */}
            <div className="mt-3.5">
              <JumpInCard />
            </div>

            {/* How it works */}
            <div className="mt-8">
              <HowItWorks />
            </div>

            <div className="flex-1" />
          </div>
        )}

        {/* ── STATE C: Logged-in, has sessions ─────────────── */}
        {sessions && hasAny && (
          <div className="flex-1 flex flex-col">
            {/* Live cards — light treatment */}
            {liveSessions.length > 0 && (
              <div className="px-5 pt-[18px] flex flex-col gap-3">
                {liveSessions.map((s) => (
                  <Link
                    key={s.id}
                    to={`/session/${s.id}/host`}
                    className="anim-rise block rounded-3xl bg-surface border border-line overflow-hidden shadow-[0_1px_3px_rgba(13,13,13,0.05)] active:scale-[0.99] transition-transform"
                  >
                    <div className="px-5 pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-court-lime/20 pl-1.5 pr-2.5 py-1">
                          <span className="relative w-2 h-2 inline-flex items-center justify-center" aria-hidden>
                            <span className="absolute w-2 h-2 rounded-full bg-court-lime animate-ping" />
                            <span className="w-2 h-2 rounded-full bg-[#8FB01E]" />
                          </span>
                          <span className="font-mono font-semibold text-[9.5px] tracking-[0.16em] text-ink">LIVE</span>
                        </span>
                        <span className="text-[12px] text-warm-gray">Code <span className="font-mono">{s.joinCode}</span></span>
                      </div>
                      <div className="font-serif font-semibold text-[23px] text-graphite mt-3.5">{s.name}</div>
                      <div className="text-[12.5px] text-warm-gray mt-1">
                        {FORMAT_LABELS[s.format] ?? s.format}
                        {s.roundCount > 0 && <> · Round <span className="font-mono tnum">{s.roundCount}</span> in play</>}
                      </div>
                      <div className="mt-4 pt-3.5 border-t border-line flex items-center justify-between">
                        <span className="text-[12.5px] text-ink-2">
                          <span className="font-mono tnum text-graphite font-semibold">{s.playerCount}</span> {s.playerCount === 1 ? "player" : "players"}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold-ink">
                          Resume hosting <span aria-hidden>›</span>
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Quick actions */}
            <div className="flex gap-2.5 px-5 pt-3.5">
              <Link to="/create" className="flex-1 bg-surface border border-line rounded-2xl px-4 py-[15px] shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:scale-[0.99] transition-transform">
                <div className="w-[34px] h-[34px] rounded-[11px] bg-graphite flex items-center justify-center mb-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#BFA36A" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <div className="font-serif font-semibold text-[15px] text-graphite">New session</div>
                <div className="text-[11.5px] text-warm-gray mt-0.5">Set up a fresh draw</div>
              </Link>
              <Link to="/join" className="flex-1 bg-surface border border-line rounded-2xl px-4 py-[15px] shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:scale-[0.99] transition-transform">
                <div className="w-[34px] h-[34px] rounded-[11px] bg-gold-soft flex items-center justify-center mb-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
                  </svg>
                </div>
                <div className="font-serif font-semibold text-[15px] text-graphite">Join a game</div>
                <div className="text-[11.5px] text-warm-gray mt-0.5">Have a 6-digit code?</div>
              </Link>
            </div>

            {/* Session history */}
            {pastSessions.length > 0 && (
              <>
                <div className="flex items-center justify-between px-6 pt-[26px] pb-3">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Your sessions</span>
                  <Link to="/create" className="text-[13px] font-semibold text-gold-ink active:opacity-70">New</Link>
                </div>
                <div className="px-5 flex flex-col gap-2.5">
                  {pastSessions.map((s) => (
                    <Link
                      key={s.id}
                      to={s.status === "ended" ? `/session/${s.id}/final` : `/session/${s.id}/host`}
                      className="anim-rise bg-surface border border-line rounded-2xl px-4 py-[14px] flex items-center gap-3.5 active:bg-surface-2 transition-colors shadow-[0_1px_2px_rgba(13,13,13,0.04)]"
                    >
                      {s.myRank != null ? (
                        <div
                          className={`w-[42px] h-[42px] rounded-xl flex flex-col items-center justify-center shrink-0 border ${
                            s.myRank === 1 ? "bg-gold-soft border-[#e6d6ac]" : "bg-surface-2 border-line"
                          }`}
                        >
                          <span className={`font-mono tnum font-bold text-[13px] leading-none ${s.myRank === 1 ? "text-gold-ink" : "text-ink"}`}>
                            {ordinal(s.myRank)}
                          </span>
                          <span className="text-[8.5px] text-warm-gray mt-0.5">of {s.fieldSize}</span>
                        </div>
                      ) : (
                        <div className="w-[42px] h-[42px] rounded-xl bg-surface-2 border border-line flex items-center justify-center shrink-0">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4BEB4" strokeWidth="2" strokeLinecap="round" aria-hidden>
                            <path d="M6 9h12M6 15h12M4 5h16v14H4z" />
                          </svg>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-serif font-semibold text-[15.5px] text-ink truncate">{s.name}</div>
                        <div className="flex items-center gap-2 mt-[5px]">
                          <span className="font-mono text-[10.5px] text-warm-gray">{shortDate(s.createdAt)}</span>
                          <span className="text-[10.5px] text-gold-ink bg-gold-soft px-2 py-0.5 rounded-full">
                            {FORMAT_LABELS[s.format] ?? s.format}
                          </span>
                        </div>
                      </div>
                      <span className="text-stone text-[16px] shrink-0" aria-hidden>›</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            <div className="flex-1 min-h-[16px]" />
            <p className="text-xs leading-[1.5] text-warm-gray text-center px-5 py-6">
              Have a code? <Link to="/watch" className="font-semibold text-gold-ink">Watch or join a live session.</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Single "enter a code" entry — the one participant path (watch, claim, or
 * join all live behind one code). Shared by the logged-out landing and the
 * logged-in empty state. */
function JumpInCard() {
  return (
    <Link
      to="/watch"
      className="flex items-center gap-4 rounded-3xl bg-surface border border-line px-5 py-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:scale-[0.99] transition-transform"
    >
      <span className="relative w-[44px] h-[44px] rounded-2xl bg-gold-soft flex items-center justify-center shrink-0">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <path d="M14 14.5h3.5M14 18h.01M17.5 18v3M20.5 14.5v6.5" />
        </svg>
        <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center" aria-hidden>
          <span className="absolute w-2.5 h-2.5 rounded-full bg-court-lime animate-ping" />
          <span className="w-2.5 h-2.5 rounded-full bg-court-lime border-2 border-surface" />
        </span>
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-serif text-[17px] font-semibold text-graphite">Enter a code</span>
        <span className="block text-[12.5px] text-warm-gray mt-0.5">Watch live, claim your spot, or join a game</span>
      </span>
      <span className="text-stone text-[18px]" aria-hidden>›</span>
    </Link>
  );
}

function HowItWorks() {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-4">How it works</p>
      <div className="flex flex-col gap-4">
        {STEPS.map((step) => (
          <div key={step.n} className="flex gap-[15px] items-baseline">
            <span className="font-mono font-semibold text-[15px] text-gold min-w-[20px]">{step.n}</span>
            <div>
              <div className="font-serif font-semibold text-base text-ink">{step.t}</div>
              <div className="text-[13px] leading-[1.45] text-warm-gray">{step.s}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
