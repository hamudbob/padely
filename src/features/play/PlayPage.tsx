import { useEffect, useState } from "react";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { Link } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getHostHomeSummary, HostHomeSession } from "../../lib/supabase/hostHomeQueries";
import { getResumableLobbies, sweepStaleDrafts, deleteSession, ResumableLobby } from "../../lib/supabase/sessionActions";
import { getMyUpcomingEvents, UpcomingEvent } from "../../lib/supabase/upcomingQueries";
import TabHeader from "../shell/TabHeader";
import FeatureCarousel from "./FeatureCarousel";
import { reportHandledError } from "../../lib/errorReporter";

/**
 * Play — "what do I do now?", in one screen and in priority order.
 *
 * Date, then anything live, then the one action worth taking, then everything
 * else sideways, then history. No greeting and no headline: both were prose
 * restating the cards directly beneath them, which reads as two separate facts
 * until you realise it's one.
 *
 * Three things worth knowing about the implementation:
 *
 * 1. The deck is CSS scroll-snap, not a hand-rolled pointer handler. The
 *    prototype hand-rolled the physics to prove the feel; in production the
 *    platform's own scrolling gives correct momentum, rubber-banding and — the
 *    part a custom handler gets wrong — it never fights the page's vertical
 *    scroll or the tab bar's gestures.
 *
 * 2. The primary action sits inline, not pinned to the bottom.
 *    There's already a tab bar down there; a second bottom-anchored control
 *    would be two floating things competing for the same thumb.
 *
 * 3. There's no court graphic and no live score. The score isn't in the home
 *    summary, and a plausible-looking number that isn't the real one is worse
 *    than none; the court illustration was cut for a plainer reason — it drew
 *    the eye without telling you anything the text didn't already say.
 */

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  side_americano: "Fixed Position",
  mix_mexicano: "Mix Mexicano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

function dateKicker(d: Date): string {
  return `${d.toLocaleDateString("en-GB", { weekday: "long" })} · ${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
/** "Today · 19:30", "Tomorrow · 19:30", else "Fri 15 Aug · 19:30". */
function eventWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const tom = new Date(today);
  tom.setDate(today.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return `Today · ${time}`;
  if (same(d, tom)) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })} · ${time}`;
}

export default function PlayPage() {
  const { user } = useHostSession();
  const [sessions, setSessions] = useState<HostHomeSession[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<ResumableLobby[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingEvent[]>([]);
  const [discarding, setDiscarding] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    getHostHomeSummary()
      .then((s) => setSessions(s.sessions))
      .catch((e) => {
        // Report it as well as showing it. This exact branch is what a user
        // sees when their home screen is broken, and until now it left no
        // trace anywhere.
        reportHandledError(e, "PlayPage.getHostHomeSummary");
        setError(withFallback(e, "Could not load your sessions."));
      })
      .finally(() => setLoading(false));
    sweepStaleDrafts(10)
      .catch(() => 0)
      .then(() => getResumableLobbies())
      .then(setDrafts)
      .catch(() => setDrafts([]));
    getMyUpcomingEvents(3).then(setUpcoming).catch(() => setUpcoming([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function discard(l: ResumableLobby) {
    const label = l.name?.trim() || "this setup";
    if (!confirm(`Discard ${label}? The roster you'd started and its join code are gone for good.`)) return;
    setDiscarding(l.sessionId);
    try {
      await deleteSession(l.sessionId);
      setDrafts((prev) => prev.filter((d) => d.sessionId !== l.sessionId));
    } catch (e) {
      setError(withFallback(e, "Couldn't discard that setup."));
    } finally {
      setDiscarding(null);
    }
  }

  const live = (sessions ?? []).filter((s) => s.status === "live");
  const past = (sessions ?? []).filter((s) => s.status !== "live");
  const recent = past.slice(0, 3);
  const now = new Date();

  // No headline. It kept restating whatever the cards below already showed —
  // the session name, then the next event — and a duplicated line reads as two
  // different things until you notice it isn't. The date sets the scene; the
  // content speaks for itself.
  // Secondary things, all in one horizontal deck rather than stacked down the page.
  type Card = { key: string; kicker: string; title: string; meta: string; to: string; cta: string; onX?: () => void; busy?: boolean };
  //
  // Live sessions are NOT in here — they all render as cards at the top. A
  // second running session is the most urgent thing on the screen after the
  // first, and demoting it into a sideways deck buried it.
  //
  // Every upcoming event IS in here. This deck is the only place a scheduled
  // session appears, so nothing may be filtered out of it — an earlier version
  // hid the soonest one and made the next session unreachable from this screen.
  const cards: Card[] = [
    ...drafts.map((l) => ({
      key: `draft-${l.sessionId}`,
      kicker: "Unfinished setup",
      title: l.name || "Untitled session",
      meta: `${l.playerCount} ${l.playerCount === 1 ? "player" : "players"} waiting · code ${l.joinCode}`,
      to: `/create?resume=${l.sessionId}`,
      cta: "Finish setup",
      onX: () => discard(l),
      busy: discarding === l.sessionId,
    })),
    ...upcoming.map((e) => ({
      key: `ev-${e.id}`,
      kicker: e.myResponse === "in" ? "You're in" : "Scheduled",
      title: e.title,
      meta: `${eventWhen(e.scheduledAt)} · ${e.clubName}`,
      to: `/e/${e.id}`,
      cta: e.myResponse === "in" ? "Change RSVP" : "Say you're in",
    })),
  ];

  // The button is always "create", never "resume". Tapping the court card is
  // how you get back into a running session — having a button that went to the
  // same place meant two controls doing one job, while the action people
  // actually couldn't reach from a live screen was starting the next session.
  const primary = {
    to: "/create",
    label: past.length > 0 || live.length > 0 ? "Start a session" : "Create your first session",
  };

  // Where the slideshow goes depends on whether there's anything real to show.
  // On a quiet screen it sits straight under the buttons — that emptiness is
  // what it's for. On a screen with a live session and a history it drops below
  // Recent, because an advert above someone's own sessions is the wrong way
  // round.
  const quiet = live.length === 0 && past.length === 0;

  return (
    <>
      <TabHeader />

      <div className="flex-1 flex flex-col anim-fade">
        {/* ── The state, stated ───────────────────────────────────────── */}
        <div className="px-5 pt-2 pb-1">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-gold-ink">{dateKicker(now)}</p>
        </div>

        {loading && !sessions && (
          <div className="px-5 pt-5 flex flex-col gap-2.5">
            <div className="h-[168px] rounded-3xl skeleton" />
            <div className="h-[56px] rounded-full skeleton" />
          </div>
        )}
        <ErrorNote error={error} where="PlayPage.getHostHomeSummary" />

        {/* ── The live session ────────────────────────────────────────
            No court graphic — it was decoration on a screen whose whole job is
            "get me back in". What's left is what you actually check before
            tapping: which session, how far in, how many players, and the code
            people keep asking you for. */}
        {live.length > 0 && (
          <div className="px-5 pt-[18px] flex flex-col gap-2.5">
            {live.map((session) => (
            <Link
              key={session.id}
              to={`/session/${session.id}/host`}
              className="block rounded-3xl bg-surface border border-line px-5 pt-4 pb-4 shadow-[0_2px_10px_-4px_rgba(13,13,13,0.10)] active:scale-[0.99] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-court-lime/25 pl-1.5 pr-2.5 py-1">
                  <span className="relative w-2 h-2 inline-flex items-center justify-center" aria-hidden>
                    <span className="absolute w-2 h-2 rounded-full bg-court-lime animate-ping" />
                    <span className="w-2 h-2 rounded-full bg-[#8FB01E]" />
                  </span>
                  <span className="font-mono font-semibold text-[9.5px] tracking-[0.16em] text-ink">LIVE</span>
                </span>
                <span className="text-[11.5px] text-warm-gray">
                  Code <span className="font-mono text-ink">{session.joinCode}</span>
                </span>
              </div>

              <p className="font-serif text-[24px] font-semibold text-graphite tracking-tight mt-3.5 leading-tight">
                {session.name}
              </p>
              <p className="text-[12.5px] text-warm-gray mt-1">
                {FORMAT_LABELS[session.format] ?? session.format}
                {session.roundCount > 0 && <> · Round <span className="font-mono tnum">{session.roundCount}</span></>}
                {" · "}
                <span className="font-mono tnum">{session.playerCount}</span> {session.playerCount === 1 ? "player" : "players"}
              </p>

              <div className="mt-4 pt-3.5 border-t border-line flex items-center justify-end">
                <span className="text-[13px] font-semibold text-gold-ink">Resume hosting ›</span>
              </div>
            </Link>
            ))}
          </div>
        )}

        {/* On a quiet screen the slideshow leads, above the buttons: with
            nothing live and nothing played, "what can this thing do" is the
            actual question, and the answer should be the first thing on the
            page rather than a footnote under two controls. On a screen with a
            live session it stays down by Recent — there, the buttons are the
            question. */}
        {sessions && quiet && <FeatureCarousel />}

        {/* ── One action, following from the state ────────────────────── */}
        {sessions && (
          <div className="px-5 pt-4">
            <Link
              to={primary.to}
              className="w-full h-[54px] flex items-center justify-center gap-2.5 rounded-full bg-graphite text-ivory text-[15px] font-semibold shadow-[0_10px_22px_-10px_rgba(13,13,13,0.55)] active:scale-[0.98] transition-transform"
            >
              {primary.label}
            </Link>
            <div className="flex gap-2 mt-2">
              <Link
                to="/watch"
                className="flex-1 h-[44px] flex items-center justify-center rounded-full border-[1.5px] border-line text-ink-2 text-[13px] font-semibold bg-surface active:scale-[0.98] transition-transform"
              >
                Enter a code
              </Link>
              <Link
                to="/teams"
                className="flex-1 h-[44px] flex items-center justify-center rounded-full border-[1.5px] border-line text-ink-2 text-[13px] font-semibold bg-surface active:scale-[0.98] transition-transform"
              >
                Your clubs
              </Link>
            </div>
          </div>
        )}

        {/* ── Everything else, sideways instead of downwards ──────────── */}
        {cards.length > 0 && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-warm-gray px-6 pt-7 pb-2.5">
              Also happening
            </p>
            <div className="overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-0">
              <div className="flex gap-3 px-5 pb-1">
                {cards.map((c) => (
                  <div key={c.key} className={`relative snap-start shrink-0 w-[264px] ${c.busy ? "opacity-40" : ""}`}>
                    <Link
                      to={c.to}
                      className="block h-full rounded-2xl bg-surface border border-line px-4 py-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:scale-[0.99] transition-transform"
                    >
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-gold-ink">{c.kicker}</p>
                      <p className="font-serif text-[18px] font-semibold text-graphite mt-1.5 truncate">{c.title}</p>
                      <p className="text-[12px] text-warm-gray mt-1 truncate">{c.meta}</p>
                      <p className="text-[12.5px] font-semibold text-gold-ink mt-3 pt-3 border-t border-line">{c.cta} ›</p>
                    </Link>
                    {c.onX && (
                      <button
                        onClick={c.onX}
                        disabled={c.busy}
                        aria-label={`Discard ${c.title}`}
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full text-warm-gray flex items-center justify-center text-[14px] leading-none active:bg-surface-2 transition-colors disabled:opacity-40"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Recent — the tail of the present. The archive is on You. ── */}
        {recent.length > 0 && (
          <>
            <div className="flex items-center justify-between px-6 pt-7 pb-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-warm-gray">Recent</span>
              <Link to="/profile" className="text-[13px] font-semibold text-gold-ink active:opacity-70">
                All sessions
              </Link>
            </div>
            <div className="px-5 flex flex-col gap-2.5">
              {recent.map((s) => (
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

        {/* First run: explain the thing before asking them to do it. */}
        {sessions && past.length === 0 && live.length === 0 && (
          <div className="px-6 pt-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-warm-gray mb-4">How it works</p>
            <div className="flex flex-col gap-4">
              {[
                { n: "01", t: "Create", s: "Name it, pick a format, add players." },
                { n: "02", t: "Play", s: "The app draws fair rounds; tap to score." },
                { n: "03", t: "Rank", s: "A live leaderboard, right to the last game." },
              ].map((step) => (
                <div key={step.n} className="flex gap-[15px] items-baseline">
                  <span className="font-mono font-semibold text-[15px] text-gold-ink min-w-[20px]">{step.n}</span>
                  <div>
                    <div className="font-serif font-semibold text-base text-ink">{step.t}</div>
                    <div className="text-[13px] leading-[1.45] text-warm-gray">{step.s}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sessions && !quiet && <FeatureCarousel />}

        <div className="flex-1 min-h-[16px]" />

        {/* Same line as the logged-out home. Signing up doesn't make the
            questions go away — most of them (rating, clubs, compensation)
            only start once you're in. */}
        <p className="text-[12px] leading-[1.5] text-warm-gray text-center px-6 pt-7 pb-2">
          <Link to="/about" className="font-semibold text-gold-ink">How it all works</Link>
        </p>
      </div>
    </>
  );
}
