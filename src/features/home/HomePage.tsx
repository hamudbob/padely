import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getHostHomeSummary, HostHomeSession, HostHomeStats } from "../../lib/supabase/hostHomeQueries";
import { getResumableLobbies, sweepStaleDrafts, ResumableLobby } from "../../lib/supabase/sessionActions";

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
  return new Date(iso)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    .toUpperCase();
}

// "1st" / "2nd" / "3rd" / "4th"…
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const HERO_GRADIENT = "linear-gradient(168deg,#FBFAF8 0%,#F7F0E3 130%)";
const GOLD_HAIRLINE = "linear-gradient(90deg,#BFA36A,rgba(191,163,106,0))";
const CREATE_CARD_GRADIENT = "linear-gradient(165deg,#FBFAF8,#F7F0E3)";
const LIVE_CARD_GRADIENT = "linear-gradient(160deg,#141412,#242320)";
const LIME_HAIRLINE = "linear-gradient(90deg,#C4E24B,rgba(196,226,75,0))";

/**
 * Home — three states, per the "Padelier Home" design:
 *   A. Logged-out landing (hero + CTAs + how-it-works)
 *   B. Logged-in, no sessions (create/join cards + how-it-works)
 *   C. Logged-in, has sessions (greeting + stat strip + live card + quick
 *      actions + history with finishing place)
 * Bound to real data via getHostHomeSummary (one batched pass that also computes
 * the host's finishing place per session and account-level stats).
 */
export default function HomePage() {
  const { user } = useHostSession();
  const [sessions, setSessions] = useState<HostHomeSession[] | null>(null);
  const [stats, setStats] = useState<HostHomeStats | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [resumable, setResumable] = useState<ResumableLobby[]>([]);

  useEffect(() => {
    if (!user) {
      setSessions(null);
      setStats(null);
      setResumable([]);
      return;
    }
    setSessionsLoading(true);
    setSessionsError(null);
    getHostHomeSummary()
      .then((summary) => {
        setSessions(summary.sessions);
        setStats(summary.stats);
      })
      .catch((err) => setSessionsError(err instanceof Error ? err.message : "Could not load your sessions."))
      .finally(() => setSessionsLoading(false));
    // Opportunistic housekeeping: sweep the host's own drafts older than 10
    // days, then surface any lobby they left mid-setup as "Resume setup".
    // Both best-effort — a failure here must never block the home screen.
    sweepStaleDrafts(10)
      .catch(() => 0)
      .then(() => getResumableLobbies())
      .then(setResumable)
      .catch(() => setResumable([]));
    // Depend on the user *id*, not the whole user object: supabase hands back a
    // fresh user reference on every hourly TOKEN_REFRESHED, which would
    // otherwise re-run this entire batched summary load for no reason.
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
    <div className="flex items-center justify-between px-6 pt-4 pb-2.5">
      <span className="font-wordmark text-[21px] font-semibold text-ink flex items-baseline leading-none">
        Padelier
        <span className="text-gold">.</span>
      </span>
      {user ? (
        <Link
          to="/profile"
          aria-label="Your dashboard"
          className="w-9 h-9 rounded-full bg-gold-soft border border-line flex items-center justify-center font-mono text-sm font-semibold text-gold-ink active:scale-95 transition-transform"
        >
          {initialsOf(user)}
        </Link>
      ) : (
        <Link to="/login" className="text-sm font-medium text-ink-2 active:opacity-70">
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
          <div
            className="relative mx-4 mt-1.5 rounded-[22px] border border-line px-6 pt-[26px] pb-7 overflow-hidden"
            style={{ background: HERO_GRADIENT }}
          >
            <div className="absolute top-0 left-6 right-6 h-0.5" style={{ background: GOLD_HAIRLINE }} aria-hidden />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-ink mb-4">Padel, run right</p>
            <h1 className="font-serif text-[41px] font-medium leading-[1.02] tracking-[-0.01em] text-ink text-balance">
              The art of a great game.
            </h1>
            <p className="text-sm leading-relaxed text-ink-2 mt-4 max-w-[280px]">
              Fair rounds, one-tap scores, a live leaderboard — from the first serve to the final table.
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-2.5 px-4 pt-5">
            <Link
              to="/create"
              className="flex items-center justify-between rounded-2xl bg-graphite text-ivory px-4 py-4 text-[15px] font-semibold active:scale-[0.99] transition-transform"
            >
              Create a session
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#BFA36A" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
            <Link
              to="/join"
              className="flex items-center justify-between rounded-2xl bg-surface border border-line text-ink px-4 py-4 text-[15px] font-semibold active:scale-[0.99] transition-transform"
            >
              Join a game
              <span className="font-mono text-[13px] tracking-[0.08em] text-warm-gray">6-digit code</span>
            </Link>
          </div>

          <div className="h-px bg-line mx-6 mt-[22px]" />

          {/* How it works */}
          <div className="px-6 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-warm-gray mb-4">How it works</p>
            <div className="flex flex-col gap-4">
              {[
                { n: "01", t: "Create", s: "Name it, pick a format, add players." },
                { n: "02", t: "Play", s: "The app draws fair rounds; tap to score." },
                { n: "03", t: "Rank", s: "A live leaderboard, right to the last game." },
              ].map((step) => (
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
          <div className="flex-1" />
        </div>
      </div>
    );
  }

  /* ── Logged-in header (greeting) ─────────────────────── */
  const firstName = firstNameOf(user);
  const statusLine = liveSessions.length > 0
    ? `${liveSessions.length === 1 ? "One session" : `${liveSessions.length} sessions`} live now — pick up where you left off.`
    : hasAny
      ? "No session running — start a fresh draw when you're ready."
      : "Let's set up your first session — a fair draw is seconds away.";

  return (
    <div className={shell}>
      {appBar}

      <div className="flex-1 flex flex-col">
        <div className="px-6 pt-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-gold-ink mb-2">{dateKicker(now)}</p>
          <h1 className="font-serif text-[30px] font-medium leading-[1.05] tracking-[-0.01em] text-ink">
            {greeting}, {firstName}.
          </h1>
          {sessions && (
            <p className="text-sm leading-relaxed text-warm-gray mt-2">{statusLine}</p>
          )}
        </div>

        {/* Stat strip — only once there's real history to summarise */}
        {stats && hasAny && (
          <div className="flex gap-2.5 px-6 pt-[18px]">
            {[
              { n: String(stats.sessionsHosted), l: "Sessions hosted" },
              { n: String(stats.activeThisMonth), l: "This month", em: true },
              { n: String(stats.gamesPlayed), l: "Games played" },
            ].map((st) => (
              <div key={st.l} className="flex-1 bg-surface border border-line rounded-2xl px-3.5 py-3">
                <div className="font-mono tnum font-bold text-[22px] text-ink leading-none">{st.n}</div>
                <div className="text-[11px] text-warm-gray mt-1.5 leading-tight">{st.l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Resume setup — a lobby the host left mid-setup, everyone still in it */}
        {resumable.length > 0 && (
          <div className="px-4 pt-4 flex flex-col gap-2.5">
            {resumable.map((l) => (
              <Link
                key={l.sessionId}
                to={`/create?resume=${l.sessionId}`}
                className="anim-rise relative block rounded-[20px] border-[1.5px] border-dashed px-[22px] py-4 active:scale-[0.99] transition-transform"
                style={{ background: CREATE_CARD_GRADIENT, borderColor: "#D8C79A" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-ink">Resume setup</p>
                    <p className="font-serif font-semibold text-[17px] text-ink truncate mt-0.5">{l.name || "Untitled session"}</p>
                    <p className="text-[12px] text-warm-gray mt-0.5">
                      {l.playerCount} {l.playerCount === 1 ? "player" : "players"} waiting · code <span className="font-mono">{l.joinCode}</span>
                    </p>
                  </div>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Loading */}
        {sessionsLoading && !sessions && (
          <div className="px-4 pt-5 flex flex-col gap-2.5">
            <div className="h-[150px] rounded-[20px] skeleton" />
            <div className="h-[68px] rounded-2xl skeleton" />
            <div className="h-[68px] rounded-2xl skeleton" />
          </div>
        )}
        {sessionsError && <p className="text-sm text-loss px-6 pt-4">{sessionsError}</p>}

        {/* ── STATE B: Logged-in, no sessions ──────────────── */}
        {sessions && !hasAny && (
          <div className="flex-1 flex flex-col px-6">
            {/* Primary dashed create card */}
            <Link
              to="/create"
              className="mt-[26px] rounded-[20px] border-[1.5px] border-dashed px-[22px] py-[26px] active:scale-[0.99] transition-transform"
              style={{ background: CREATE_CARD_GRADIENT, borderColor: "#D8C79A" }}
            >
              <div className="w-[46px] h-[46px] rounded-[14px] bg-graphite flex items-center justify-center mb-[18px]">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BFA36A" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div className="font-serif font-semibold text-xl text-ink">Create a session</div>
              <div className="text-[13.5px] leading-[1.5] text-ink-2 mt-[7px] max-w-[250px]">
                Name it, pick a play &amp; scoring format, add players. We'll handle the rounds.
              </div>
              <div className="mt-4 inline-flex items-center gap-[7px] text-[13px] font-semibold text-gold-ink">
                Start setup
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </div>
            </Link>

            {/* Secondary dashed join card */}
            <Link
              to="/join"
              className="mt-3.5 rounded-[20px] bg-surface border-[1.5px] border-dashed border-line px-[22px] py-5 flex items-center gap-4 active:scale-[0.99] transition-transform"
            >
              <div className="w-[42px] h-[42px] rounded-xl bg-ivory border border-line flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4A4944" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
                </svg>
              </div>
              <div>
                <div className="font-serif font-semibold text-base text-ink">Join a game</div>
                <div className="text-[13px] text-warm-gray mt-0.5">Have a 6-digit code? Hop in.</div>
              </div>
            </Link>

            {/* How it works — so a fresh account isn't left staring at empty space */}
            <div className="mt-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warm-gray mb-4">How it works</p>
              <div className="flex flex-col gap-4">
                {[
                  { n: "01", t: "Create", s: "Name it, pick a format, add players." },
                  { n: "02", t: "Play", s: "The app draws fair rounds; tap to score." },
                  { n: "03", t: "Rank", s: "A live leaderboard, right to the last game." },
                ].map((step) => (
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

            <div className="flex-1" />
            <p className="text-xs leading-[1.5] text-warm-gray text-center px-5 py-6">
              Just watching? <Link to="/watch" className="font-semibold text-gold-ink">Watch a live session by code.</Link>
            </p>
          </div>
        )}

        {/* ── STATE C: Logged-in, has sessions ─────────────── */}
        {sessions && hasAny && (
          <div className="flex-1 flex flex-col">
            {/* Live cards — premium dark treatment */}
            {liveSessions.length > 0 && (
              <div className="px-4 pt-[18px] flex flex-col gap-3">
                {liveSessions.map((s) => (
                  <Link
                    key={s.id}
                    to={`/session/${s.id}/host`}
                    className="anim-rise relative block rounded-[22px] overflow-hidden text-ivory active:scale-[0.99] transition-transform shadow-[0_18px_40px_-22px_rgba(20,20,18,0.7)]"
                    style={{ background: LIVE_CARD_GRADIENT }}
                  >
                    <span className="absolute top-0 left-[22px] right-[22px] h-0.5" style={{ background: LIME_HAIRLINE }} aria-hidden />
                    <div className="px-[22px] pt-[22px] pb-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="relative w-2 h-2 inline-flex items-center justify-center" aria-hidden>
                            <span className="absolute w-2 h-2 rounded-full bg-court-lime animate-ping" />
                            <span className="w-2 h-2 rounded-full bg-[#A9CC2E]" />
                          </span>
                          <span className="font-mono font-semibold text-[10.5px] tracking-[0.16em] text-[#cfe86a]">LIVE</span>
                        </div>
                        <span className="text-[12px] text-ivory/55">Code {s.joinCode}</span>
                      </div>
                      <div className="font-serif font-medium text-[24px] text-ivory mt-3.5">{s.name}</div>
                      <div className="text-[12.5px] text-ivory/60 mt-1">
                        {FORMAT_LABELS[s.format] ?? s.format}
                        {s.roundCount > 0 && <> · Round <span className="font-mono tnum">{s.roundCount}</span> in play</>}
                      </div>
                      <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between">
                        <span className="text-[12.5px] text-ivory/70">
                          <span className="font-mono tnum text-ivory">{s.playerCount}</span> {s.playerCount === 1 ? "player" : "players"}
                        </span>
                        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ivory">
                          Resume hosting
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#BFA36A" strokeWidth="2" strokeLinecap="round" aria-hidden>
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Quick actions */}
            <div className="flex gap-2.5 px-4 pt-3.5">
              <Link
                to="/create"
                className="flex-1 bg-surface border border-line rounded-2xl px-4 py-[15px] active:scale-[0.99] transition-transform"
              >
                <div className="w-[34px] h-[34px] rounded-[11px] bg-graphite flex items-center justify-center mb-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#BFA36A" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <div className="font-serif font-semibold text-[15px] text-ink">New session</div>
                <div className="text-[11.5px] text-warm-gray mt-0.5">Set up a fresh draw</div>
              </Link>
              <Link
                to="/join"
                className="flex-1 bg-surface border border-line rounded-2xl px-4 py-[15px] active:scale-[0.99] transition-transform"
              >
                <div className="w-[34px] h-[34px] rounded-[11px] bg-gold-soft flex items-center justify-center mb-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
                  </svg>
                </div>
                <div className="font-serif font-semibold text-[15px] text-ink">Join a game</div>
                <div className="text-[11.5px] text-warm-gray mt-0.5">Have a 6-digit code?</div>
              </Link>
            </div>

            {/* Session history */}
            {pastSessions.length > 0 && (
              <>
                <div className="flex items-center justify-between px-6 pt-[26px] pb-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warm-gray">Your sessions</span>
                  <Link to="/create" className="text-[13px] font-semibold text-gold-ink active:opacity-70">New</Link>
                </div>
                <div className="px-4 flex flex-col gap-2.5">
                  {pastSessions.map((s) => (
                    <Link
                      key={s.id}
                      to={s.status === "ended" ? `/session/${s.id}/final` : `/session/${s.id}/host`}
                      className="anim-rise bg-surface border border-line rounded-2xl px-[16px] py-[14px] flex items-center gap-3.5 active:bg-surface-2 transition-colors"
                    >
                      {/* Finishing-place medal (only when the host actually played) */}
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
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C4BEB4" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden>
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </Link>
                  ))}
                </div>
              </>
            )}

            <div className="flex-1 min-h-[16px]" />
            <p className="text-xs leading-[1.5] text-warm-gray text-center px-5 py-6">
              Just watching? <Link to="/watch" className="font-semibold text-gold-ink">Watch a live session by code.</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
