import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicEvent, setRsvp, PublicEvent, RsvpResponse } from "../../lib/supabase/eventQueries";
import { useHostSession } from "../../lib/supabase/useHostSession";

function whenLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

const RSVP_OPTS: { value: RsvpResponse; label: string }[] = [
  { value: "in", label: "In" },
  { value: "maybe", label: "Maybe" },
  { value: "out", label: "Out" },
];

export default function EventPage() {
  const { eventId } = useParams();
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
      <Link to="/" aria-label="Home" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</Link>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (loading) return <div className={shell}>{bar}<p className="text-[13px] text-warm-gray mt-16 text-center">Loading…</p></div>;
  if (notFound || !ev) return <div className={shell}>{bar}<p className="text-[13px] text-warm-gray mt-16 text-center">This session isn't available.</p></div>;

  const cancelled = ev.status === "cancelled";

  return (
    <div className={shell}>
      {bar}

      {/* Team line */}
      <Link to={`/teams/${ev.clubId}`} className="flex items-center justify-center gap-2 mt-2 active:opacity-70">
        <span className="w-[26px] h-[26px] rounded-[8px] bg-gold-soft text-gold-ink flex items-center justify-center text-[13px] font-serif font-semibold overflow-hidden">
          {ev.teamLogo ? <img src={ev.teamLogo} alt="" className="w-full h-full object-cover" /> : ev.teamName.charAt(0).toUpperCase()}
        </span>
        <span className="text-[12.5px] font-semibold text-ink-2">{ev.teamName}</span>
      </Link>

      {/* Title + when */}
      <div className="text-center mt-5">
        <h1 className="font-serif text-[26px] font-semibold text-graphite tracking-tight leading-tight">{ev.title}</h1>
        <p className="text-[13px] text-ink-2 mt-2">{whenLong(ev.scheduledAt)}</p>
        {ev.location && <p className="text-[12.5px] text-warm-gray mt-0.5">{ev.location}</p>}
        {cancelled && <p className="text-[12px] font-semibold text-loss mt-2">This session was cancelled.</p>}
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
                className={`flex-1 rounded-full py-2.5 text-[13px] font-semibold ${
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
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-surface px-4 py-4 text-center">
          <p className="text-[12.5px] text-ink-2 font-semibold">Members-only session</p>
          <p className="text-[12px] text-warm-gray mt-1 leading-snug">
            {user ? (
              <>Join <Link to={`/teams/${ev.clubId}`} className="font-semibold text-gold-ink">{ev.teamName}</Link> to RSVP.</>
            ) : (
              <><Link to="/login" className="font-semibold text-gold-ink">Sign in</Link> and join {ev.teamName} to RSVP.</>
            )}
          </p>
        </div>
      )}

      {/* Turnout */}
      <div className="mt-6 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        <p className="text-[13px] text-graphite">
          <b className="font-semibold tnum">{ev.counts.in}</b> in
          {ev.counts.maybe > 0 ? <> · <b className="font-semibold tnum">{ev.counts.maybe}</b> maybe</> : null}
          {ev.counts.out > 0 ? <> · <b className="font-semibold tnum">{ev.counts.out}</b> out</> : null}
        </p>
        {ev.goingNames.length > 0 && (
          <p className="text-[11.5px] text-warm-gray mt-1.5 leading-snug">{ev.goingNames.slice(0, 12).join(", ")}{ev.goingNames.length > 12 ? "…" : ""}</p>
        )}
      </div>

      <button onClick={share} className="w-full mt-6 rounded-full border border-line bg-surface text-ink-2 text-[12.5px] font-semibold py-2.5 active:bg-surface-2 transition-colors">
        {copied ? "Link copied ✓" : "Share this session"}
      </button>
    </div>
  );
}
