import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicEvent, setRsvp, PublicEvent, RsvpResponse, EventAttendee } from "../../lib/supabase/eventQueries";
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

  async function respond(response: RsvpResponse) {
    if (!eventId || !ev) return;
    setEv({ ...ev, myResponse: response }); // optimistic
    try {
      await setRsvp(eventId, response);
    } catch {
      /* reload corrects */
    }
    load();
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
            </p>
          )}
        </div>
      </div>

      {/* RSVP */}
      {!cancelled && ev.isMember && (
        <div className="mt-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray text-center mb-2">Your RSVP</p>
          <div className="flex rounded-full bg-surface border border-line p-1">
            {RSVP_OPTS.map((o) => (
              <button
                key={o.value}
                onClick={() => respond(o.value)}
                className={`flex-1 rounded-full py-2.5 text-[13px] font-semibold transition-colors ${
                  ev.myResponse === o.value ? (o.value === "out" ? "bg-warm-gray text-ivory" : "bg-graphite text-ivory") : "text-warm-gray"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!cancelled && !ev.isMember && (
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
          <TurnoutStat n={ev.counts.in} label="In" tone="win" />
          <div className="w-px h-7 bg-line" />
          <TurnoutStat n={ev.counts.maybe} label="Maybe" tone="gold" />
          <div className="w-px h-7 bg-line" />
          <TurnoutStat n={ev.counts.out} label="Out" tone="muted" />
        </div>
      </div>

      {/* Who's coming — tappable profiles */}
      <AttendeeList title="Going" people={ev.going} accent="win" />
      <AttendeeList title="Maybe" people={ev.maybe} accent="gold" />

      <button onClick={share} className="w-full mt-6 rounded-full border border-line bg-surface text-ink-2 text-[12.5px] font-semibold py-2.5 active:bg-surface-2 transition-colors">
        {copied ? "Link copied ✓" : "Share this session"}
      </button>
    </div>
  );
}

function TurnoutStat({ n, label, tone }: { n: number; label: string; tone: "win" | "gold" | "muted" }) {
  const color = tone === "win" ? "text-win" : tone === "gold" ? "text-gold-ink" : "text-warm-gray";
  return (
    <div className="flex-1 text-center">
      <p className={`font-mono tnum text-[22px] font-semibold leading-none ${n > 0 ? color : "text-stone"}`}>{n}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-gray mt-1">{label}</p>
    </div>
  );
}

function AttendeeList({ title, people, accent }: { title: string; people: EventAttendee[]; accent: "win" | "gold" }) {
  if (people.length === 0) return null;
  const dot = accent === "win" ? "bg-win" : "bg-gold";
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">{title}</h3>
        <span className="font-mono tnum text-[11px] text-warm-gray">{people.length}</span>
      </div>
      <div className="rounded-2xl bg-surface border border-line overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        {people.map((p) => (
          <Link
            key={p.userId}
            to={`/u/${p.userId}`}
            className="flex items-center gap-3 px-4 py-2.5 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors"
          >
            <span className="w-[32px] h-[32px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[12px] font-semibold overflow-hidden shrink-0">
              {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : p.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0 text-[14px] font-semibold text-graphite truncate">{p.displayName}</span>
            <span className="text-stone text-[16px]">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
