import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getPublicEvent,
  setRsvp,
  setMemberRsvp,
  eventCode,
  PublicEvent,
  RsvpResponse,
  EventAttendee,
} from "../../lib/supabase/eventQueries";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";

interface DateParts {
  weekday: string;
  day: string;
  month: string;
  time: string;
}
function dateParts(iso: string): DateParts | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
    day: d.toLocaleDateString(undefined, { day: "numeric" }),
    month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

const RSVP_OPTS: { value: RsvpResponse; label: string }[] = [
  { value: "in", label: "In" },
  { value: "maybe", label: "Maybe" },
  { value: "out", label: "Out" },
];

export default function EventPage() {
  const { eventId } = useParams();
  const back = useBackNav("/");
  const { user } = useHostSession();
  const [ev, setEv] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  function load() {
    if (!eventId) return;
    getPublicEvent(eventId)
      .then((e) => {
        if (!e) setNotFound(true);
        else setEv(e);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function respond(response: RsvpResponse) {
    if (!eventId || !ev) return;
    setNote(null);
    setEv({ ...ev, myResponse: response }); // optimistic
    try {
      // The server decides: asking to be "in" on a full night comes back as a
      // waitlist place, and the person needs telling — silently showing them
      // as waitlisted would read as a bug.
      const result = await setRsvp(eventId, response);
      if (result.waitlisted) {
        setNote(
          result.position
            ? `That session is full — you're number ${result.position} on the waiting list. We'll move you up if someone drops out.`
            : "That session is full — you're on the waiting list.",
        );
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work.");
    }
    load();
  }

  /** Host: promote off the waiting list, or take someone out. */
  async function setFor(userId: string, response: RsvpResponse, who: string) {
    if (!eventId) return;
    setBusy(true);
    setNote(null);
    try {
      await setMemberRsvp(eventId, userId, response);
      setNote(response === "in" ? `${who} is in.` : `${who} is out.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
      load();
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  // Full is a real state, not a styling detail: it changes what the In button
  // says, what a tap does, and whether the counts read 8/12 or just 8.
  const full = !!ev && ev.maxPlayers != null && ev.counts.in >= ev.maxPlayers;
  // The night stopped being a plan and became a thing that happened. Once a
  // session has been started from this event the RSVP list is no longer what
  // decides who plays — the session roster is — so the form comes down. The
  // server refuses the write too (0052); this is so nobody taps a control that
  // was only ever going to fail.
  const started = !!ev?.session && (ev.session.status === "live" || ev.session.status === "ended");
  const live = ev?.session?.status === "live";
  const myQueuePosition =
    ev && ev.myResponse === "waitlist" ? ev.waitlist.findIndex((p) => p.userId === user?.id) + 1 || null : null;

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";
  const bar = (
    <div className="flex items-center justify-between mb-2">
      <button onClick={back} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (loading) return <div className={shell}>{bar}<p className="text-[13px] text-warm-gray mt-16 text-center">Loading…</p></div>;
  if (notFound || !ev) return <div className={shell}>{bar}<p className="text-[13px] text-warm-gray mt-16 text-center">This session isn't available.</p></div>;

  const cancelled = ev.status === "cancelled";
  const dp = dateParts(ev.scheduledAt);
  const loginHref = `/login?next=${encodeURIComponent(`/e/${eventId}`)}`;

  return (
    <div className={shell}>
      {bar}

      {/* Event card */}
      <div className="mt-3 rounded-3xl bg-surface border border-line overflow-hidden shadow-[0_1px_3px_rgba(13,13,13,0.06)]">
        {/* Team chip */}
        <Link to={`/teams/${ev.clubId}`} className="flex items-center justify-center gap-2 px-5 py-3.5 active:bg-surface-2 transition-colors">
          <span className="w-[24px] h-[24px] rounded-[7px] bg-gold-soft text-gold-ink flex items-center justify-center text-[12px] font-serif font-semibold overflow-hidden">
            {ev.teamLogo ? <img src={ev.teamLogo} alt="" className="w-full h-full object-cover" /> : ev.teamName.charAt(0).toUpperCase()}
          </span>
          <span className="text-[12.5px] font-semibold text-ink-2">{ev.teamName}</span>
        </Link>

        <div className="border-t border-line px-5 pt-5 pb-6 text-center">
          {cancelled && (
            <span className="inline-block rounded-full bg-loss-soft text-loss text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1 mb-3">Cancelled</span>
          )}
          <h1 className={`font-serif text-[25px] font-semibold tracking-tight leading-tight ${cancelled ? "text-warm-gray line-through" : "text-graphite"}`}>{ev.title}</h1>
          {/* The same shorthand that goes into the share text, so the message
              in the group chat and the page it opens say the same thing. */}
          {eventCode(ev) && (
            <p className="font-mono text-[11px] font-bold tracking-[0.14em] text-gold-ink mt-1.5">{eventCode(ev)}</p>
          )}

          {/* Date ticket */}
          {dp && (
            <div className="mt-4 inline-flex items-stretch rounded-2xl border border-line overflow-hidden text-left">
              <div className="bg-gold-soft px-3.5 py-2 flex flex-col items-center justify-center">
                <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-gold-ink">{dp.month}</span>
                <span className="font-serif text-[22px] font-semibold text-graphite leading-none mt-0.5">{dp.day}</span>
              </div>
              <div className="px-4 py-2 flex flex-col justify-center">
                <span className="text-[12.5px] font-semibold text-graphite">{dp.weekday}</span>
                <span className="font-mono tnum text-[12.5px] text-warm-gray mt-0.5">{dp.time}</span>
              </div>
            </div>
          )}

          {ev.location && (
            <p className="flex items-center justify-center gap-1 text-[12.5px] text-warm-gray mt-3">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              {ev.location}
              {ev.cost ? <span className="text-gold-ink font-semibold"> · {ev.cost}</span> : null}
            </p>
          )}
        </div>

        {/* The plan, in the three numbers everyone asks for. Only rendered when
            the host actually filled them in — an empty strip of dashes would
            be worse than no strip. */}
        {(ev.courtCount || ev.durationHours || ev.maxPlayers) && (
          <div className="border-t border-line flex divide-x divide-line">
            {ev.courtCount != null && <PlanStat n={ev.courtCount} label={ev.courtCount === 1 ? "Court" : "Courts"} />}
            {ev.durationHours != null && (
              <PlanStat n={Number(ev.durationHours.toFixed(1))} label={ev.durationHours === 1 ? "Hour" : "Hours"} />
            )}
            {ev.maxPlayers != null && <PlanStat n={ev.maxPlayers} label="Players" />}
          </div>
        )}
      </div>

      {/* In play, or played. Either way the plan is over. */}
      {started && (
        <div className="mt-6">
          {live && ev.session?.publicToken ? (
            <Link
              to={`/live/${ev.session.publicToken}${ev.session.joinCode ? `?j=${ev.session.joinCode}` : ""}`}
              className="block rounded-2xl bg-graphite px-4 py-4 text-center active:scale-[0.99] transition-transform"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-court-lime/25 px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-court-lime" aria-hidden />
                <span className="text-[9.5px] font-bold tracking-[0.12em] text-ivory">LIVE NOW</span>
              </span>
              <span className="block text-[14px] font-semibold text-ivory mt-2">This session is being played</span>
              <span className="block text-[12px] text-ivory/70 mt-0.5">Tap for the live scoreboard</span>
            </Link>
          ) : (
            <div className="rounded-2xl border border-line bg-surface-2 px-4 py-4 text-center">
              <p className="text-[13.5px] font-semibold text-graphite">
                {live ? "This session is being played" : "This session has finished"}
              </p>
              <p className="text-[12px] text-warm-gray mt-1 leading-snug">
                RSVPs are closed — who played is on the session itself now.
              </p>
            </div>
          )}
        </div>
      )}

      {/* RSVP */}
      {!started && !cancelled && ev.isMember && (
        <div className="mt-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray text-center mb-2">Your RSVP</p>
          <div className="flex rounded-full bg-surface border border-line p-1">
            {RSVP_OPTS.map((o) => (
              <button
                key={o.value}
                onClick={() => respond(o.value)}
                className={`flex-1 rounded-full py-2.5 text-[13px] font-semibold transition-colors ${
                  ev.myResponse === o.value || (o.value === "in" && ev.myResponse === "waitlist")
                    ? o.value === "out"
                      ? "bg-warm-gray text-ivory"
                      : ev.myResponse === "waitlist"
                        ? "bg-gold-soft text-gold-ink"
                        : "bg-graphite text-ivory"
                    : "text-warm-gray"
                }`}
              >
                {/* "In" becomes "Join waitlist" when the night is full and you
                    aren't already in it — the label has to tell the truth
                    BEFORE the tap, not after. */}
                {o.value === "in" && full && ev.myResponse !== "in" ? "Join waitlist" : o.label}
              </button>
            ))}
          </div>
          {ev.myResponse === "waitlist" && (
            <p className="text-[12px] text-gold-ink text-center mt-2">
              You're on the waiting list{myQueuePosition ? ` — number ${myQueuePosition}` : ""}. We'll move you up if
              someone drops out.
            </p>
          )}
          {note && <p className="text-[12px] text-ink-2 text-center mt-2 leading-snug">{note}</p>}
        </div>
      )}
      {!started && !cancelled && !ev.isMember && (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-surface px-4 py-5 text-center">
          <p className="text-[13px] text-graphite font-semibold">Members-only RSVP</p>
          {user ? (
            <>
              <p className="text-[12px] text-warm-gray mt-1 leading-snug">Join {ev.teamName} to reserve your spot.</p>
              <Link to={`/teams/${ev.clubId}`} className="inline-block mt-3 rounded-full bg-graphite text-ivory text-[13px] font-semibold px-6 py-2.5 active:scale-[0.98] transition-transform">
                View {ev.teamName}
              </Link>
            </>
          ) : (
            <>
              <p className="text-[12px] text-warm-gray mt-1 leading-snug">Sign in and join {ev.teamName} to RSVP.</p>
              <Link to={loginHref} className="inline-block mt-3 rounded-full bg-graphite text-ivory text-[13px] font-semibold px-6 py-2.5 active:scale-[0.98] transition-transform">
                Sign in
              </Link>
            </>
          )}
        </div>
      )}

      {/* Turnout summary */}
      <div className="mt-6 rounded-2xl bg-surface border border-line px-4 py-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        <div className="flex items-center gap-4">
          <TurnoutStat n={ev.counts.in} of={ev.maxPlayers} label="In" tone="win" />
          <div className="w-px h-7 bg-line" />
          <TurnoutStat n={ev.counts.maybe} label="Maybe" tone="gold" />
          <div className="w-px h-7 bg-line" />
          {ev.counts.waitlist > 0 ? (
            <TurnoutStat n={ev.counts.waitlist} label="Waiting" tone="gold" />
          ) : (
            <TurnoutStat n={ev.counts.out} label="Out" tone="muted" />
          )}
        </div>
        {full && (
          <p className="text-[11px] text-gold-ink text-center mt-2.5">
            Full. Anyone joining now goes on the waiting list.
          </p>
        )}
      </div>

      {/* Who's coming — tappable profiles. Going is alphabetical because it's a
          roster you scan for a name; the waiting list is in the order people
          asked, because there the order IS the information. */}
      <AttendeeList
        title="Going"
        people={ev.going}
        accent="win"
        admin={ev.isAdmin && !cancelled}
        busy={busy}
        onRemove={(p) => setFor(p.userId, "out", p.displayName)}
      />
      <AttendeeList
        title="Waiting list"
        people={ev.waitlist}
        accent="gold"
        numbered
        admin={ev.isAdmin && !cancelled}
        busy={busy}
        onPromote={(p) => setFor(p.userId, "in", p.displayName)}
      />
      <AttendeeList
        title="Maybe"
        people={ev.maybe}
        accent="gold"
        admin={ev.isAdmin && !cancelled}
        busy={busy}
        onPromote={(p) => setFor(p.userId, "in", p.displayName)}
      />
      <AttendeeList title="Can't make it" people={ev.out} accent="muted" />

      <button onClick={share} className="w-full mt-6 rounded-full border border-line bg-surface text-ink-2 text-[12.5px] font-semibold py-2.5 active:bg-surface-2 transition-colors">
        {copied ? "Link copied ✓" : "Share this session"}
      </button>
    </div>
  );
}

/** One of the three planning numbers: 2 COURTS · 3 HOURS · 12 PLAYERS. */
function PlanStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex-1 py-3 text-center">
      <p className="font-mono tnum text-[19px] font-semibold text-graphite leading-none">{n}</p>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-warm-gray mt-1.5">{label}</p>
    </div>
  );
}

function TurnoutStat({
  n,
  of,
  label,
  tone,
}: {
  n: number;
  /** The cap, when there is one — "8/12" answers a question "8" doesn't. */
  of?: number | null;
  label: string;
  tone: "win" | "gold" | "muted";
}) {
  const color = tone === "win" ? "text-win" : tone === "gold" ? "text-gold-ink" : "text-warm-gray";
  return (
    <div className="flex-1 text-center">
      <p className={`font-mono tnum text-[22px] font-semibold leading-none ${n > 0 ? color : "text-stone"}`}>
        {n}
        {of != null && <span className="text-[13px] text-warm-gray">/{of}</span>}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-gray mt-1">{label}</p>
    </div>
  );
}

function AttendeeList({
  title,
  people,
  accent,
  numbered,
  admin,
  busy,
  onPromote,
  onRemove,
}: {
  title: string;
  people: EventAttendee[];
  accent: "win" | "gold" | "muted";
  /** Show 1, 2, 3 — only the waiting list, where position is the point. */
  numbered?: boolean;
  admin?: boolean;
  busy?: boolean;
  onPromote?: (p: EventAttendee) => void;
  onRemove?: (p: EventAttendee) => void;
}) {
  if (people.length === 0) return null;
  const dot = accent === "win" ? "bg-win" : accent === "gold" ? "bg-gold" : "bg-stone";
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">{title}</h3>
        <span className="font-mono tnum text-[11px] text-warm-gray">{people.length}</span>
      </div>
      <div className="rounded-2xl bg-surface border border-line overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        {people.map((p, i) => (
          <div key={p.userId} className="flex items-center gap-3 px-4 py-2.5 border-t border-line first:border-t-0">
            {numbered && (
              <span className="font-mono tnum text-[12px] font-semibold text-warm-gray w-4 shrink-0">{i + 1}</span>
            )}
            <Link to={`/u/${p.userId}`} className="flex items-center gap-3 flex-1 min-w-0 active:opacity-70">
              <span className="w-[32px] h-[32px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[12px] font-semibold overflow-hidden shrink-0">
                {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : p.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 text-[14px] font-semibold text-graphite truncate">{p.displayName}</span>
            </Link>
            {/* Host controls sit OUTSIDE the profile link — a mis-tap that
                removes someone from Monday's session is not a mis-tap you get
                to take back quietly. */}
            {admin && onPromote && (
              <button
                onClick={() => onPromote(p)}
                disabled={busy}
                className="shrink-0 text-[11.5px] font-semibold text-gold-ink border border-gold/40 bg-gold-soft rounded-full px-2.5 py-1 active:opacity-70 disabled:opacity-40"
              >
                Move in
              </button>
            )}
            {admin && onRemove && (
              <button
                onClick={() => onRemove(p)}
                disabled={busy}
                className="shrink-0 text-[11.5px] font-semibold text-warm-gray border border-line rounded-full px-2.5 py-1 active:opacity-70 disabled:opacity-40"
              >
                Remove
              </button>
            )}
            {!admin && (
              <span className="text-stone text-[16px]" aria-hidden>
                ›
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
