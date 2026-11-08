import { ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getPublicEvent,
  setRsvp,
  setMemberRsvp,
  eventCode,
  eventPath,
  eventShareText,
  PublicEvent,
  RsvpResponse,
  EventAttendee,
  addEventGuest,
  removeEventGuest,
  getCallupRules,
  getCallupExtras,
  getClubAdminTodo,
  cancelEvent,
  mapsLinkFor,
  CallupExtras,
  PaymentMode,
} from "../../lib/supabase/eventQueries";
import { AdminPayments, CallupNotes, PaidCount, PlayerPayment } from "./CallupPayment";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";
import { SkeletonScreen, SkeletonBlock, SkeletonRows } from "../shell/Skeleton";
import { shareUrl } from "../../lib/shareLink";
import ConfirmSheet, { ConfirmRequest } from "../shell/ConfirmSheet";
import { BottomSheet } from "../shell/Sheet";
import CallupFormSheet, { PinIcon } from "./club/CallupFormSheet";
import { Face, Segmented, card } from "./club/ui";

/**
 * The Call-up page (ADR-002). Readable by anyone with the link; members answer
 * here, admins run the night from the ⋯ menu and the Payments tab.
 *
 * Order, top to bottom: what and where (header card), what it means for me
 * (Your spot), what the admin wrote (Notes), then who's coming.
 */

function whenLine(iso: string, hours: number | null): { day: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const t = (x: Date) => x.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const end = hours && hours > 0 ? new Date(d.getTime() + hours * 3600 * 1000) : null;
  return { day, time: end ? `${t(d)} – ${t(end)}` : t(d) };
}

const PAY_LABEL: Record<PaymentMode, string | undefined> = {
  none: undefined,
  tick: "Pay the admin · they tick you off",
  receipt: "Pay first · send your receipt",
  prepay: "Pay to get in · your receipt gets you a spot",
};

const RSVP_OPTS: { value: RsvpResponse; label: string }[] = [
  { value: "in", label: "I'm in" },
  { value: "maybe", label: "Maybe" },
  { value: "out", label: "Can't make it" },
];

type ListKey = "going" | "waitlist" | "maybe" | "out";

export default function EventPage() {
  const { eventId } = useParams();
  const back = useBackNav("/");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useHostSession();
  const [ev, setEv] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  // Notes and payments (0080) and the map link (0081). Separate from the event
  // itself: the public page is readable signed out, notes are for members.
  const [extras, setExtras] = useState<CallupExtras | null>(null);
  const [payVersion, setPayVersion] = useState(0);
  const [toCheck, setToCheck] = useState(0);

  function load() {
    if (!eventId) return;
    getPublicEvent(eventId)
      .then((e) => {
        if (!e) setNotFound(true);
        else {
          setEv(e);
          getCallupExtras(e.id).then(setExtras);
          if (e.isMember || e.isAdmin) setPayVersion((v) => v + 1);
          if (e.isAdmin) getClubAdminTodo(e.clubId).then((t) => setToCheck(t.find((x) => x.eventId === e.id)?.toCheck ?? 0));
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const [rules, setRules] = useState<{ maxGuests: number; waitlist: boolean }>({ maxGuests: 3, waitlist: true });
  const clubIdForRules = ev?.clubId ?? null;
  useEffect(() => {
    if (!clubIdForRules) return;
    let live = true;
    getCallupRules(clubIdForRules).then((r) => live && setRules(r));
    return () => {
      live = false;
    };
  }, [clubIdForRules]);

  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bringing someone who isn't on the app (0056).
  const [guestOpen, setGuestOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestGender, setGuestGender] = useState<"M" | "F">("M");
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestErr, setGuestErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState<{ p: EventAttendee; list: ListKey } | null>(null);
  const [list, setList] = useState<ListKey | null>(null);
  const adminTab: "players" | "payments" = params.get("tab") === "payments" ? "payments" : "players";

  // NOTE ON eventId vs ev.id, which is the bug this page shipped with.
  //
  // Since 0055 the URL carries a readable slug — /e/kemang-tuesday-night — and
  // `eventId` here is whatever is in the path. That is the right thing to
  // RESOLVE with and the right thing to put in a link, but it is not an id.
  // Passing it to an RPC that declares `p_event_id uuid` fails in Postgres with
  // "invalid input syntax for type uuid", which is what stopped people RSVPing
  // from a shared link.
  //
  // The resolved row already carries the real one. So: `eventId` for reading
  // and for links, `ev.id` for anything that writes.

  /**
   * Leaving a spot you hold is the one RSVP move that cannot be undone.
   *
   * Everything else on this control is freely reversible — "maybe" to "in",
   * "out" to "in" on a night with room. But giving up a CONFIRMED spot hands
   * it to the next person on the waiting list the moment the write lands, and
   * the way back is the end of that queue. That asymmetry, not the tap itself,
   * is what earns a confirmation; returns null when there is nothing to warn
   * about, so the common taps stay one tap.
   */
  function leaveWarning(next: RsvpResponse): Omit<ConfirmRequest, "run"> | null {
    if (!ev) return null;
    const leavingSpot = ev.myResponse === "in" && next !== "in";
    const leavingQueue = ev.myResponse === "waitlist" && next !== "in" && next !== "waitlist";
    if (!leavingSpot && !leavingQueue) return null;

    const waiting = ev.counts.waitlist;
    if (leavingSpot && extras?.me?.paid) {
      return {
        title: "You've already paid",
        body: `You're marked as paid for ${ev.title}. Leaving gives up your spot${
          waiting > 0 ? " to the next person waiting" : ""
        }, and the money isn't returned by the app: the admins will be told, so sort out a refund with them.`,
        confirmLabel: next === "out" ? "Yes, I'm out" : "Change me to maybe",
        tone: "danger" as const,
      };
    }
    if (leavingSpot) {
      return {
        title: "Give up your spot?",
        body:
          waiting > 0
            ? `You're in for this session. Leaving hands your spot straight to the next person waiting${
                waiting > 1 ? ` (${waiting} are in the queue)` : ""
              } — if you change your mind you'd rejoin at the back of the list.`
            : "You're in for this session. You can answer again later, though if the night fills up in the meantime you'd join the waiting list.",
        confirmLabel: next === "out" ? "Yes, I'm out" : "Change me to maybe",
        tone: "danger" as const,
      };
    }
    if (prepay && extras?.me?.hasReceipt) {
      return {
        title: "Withdraw your receipt?",
        body: "Your receipt is waiting to be checked. Leaving withdraws it and frees the spot it was holding; if you come back, you'd upload again and go to the back of the line.",
        confirmLabel: "Leave and withdraw it",
        tone: "danger" as const,
      };
    }
    return {
      title: "Leave the waiting list?",
      body: myQueuePosition
        ? `You're number ${myQueuePosition} in the queue. Leaving gives up that place — rejoining later starts you at the back.`
        : "Leaving gives up your place in the queue — rejoining later starts you at the back.",
      confirmLabel: "Leave the waiting list",
      tone: "danger" as const,
    };
  }

  function respond(response: RsvpResponse) {
    if (!eventId || !ev) return;
    if (response === ev.myResponse || (response === "in" && ev.myResponse === "waitlist")) return;
    const warn = leaveWarning(response);
    if (warn) {
      setConfirm({ ...warn, run: () => doRespond(response) });
      return;
    }
    void doRespond(response);
  }

  async function doRespond(response: RsvpResponse) {
    if (!eventId || !ev) return;
    setNote(null);
    setEv({ ...ev, myResponse: response }); // optimistic
    try {
      // The server decides: asking to be "in" on a full night comes back as a
      // waitlist place, and the person needs telling — silently showing them
      // as waitlisted would read as a bug.
      const result = await setRsvp(ev.id, response);
      if (result.prepay && result.response === "waitlist") {
        setNote("You're on the list. Pay, then upload your receipt below to ask for a spot.");
      } else if (result.waitlisted) {
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

  async function addGuest() {
    if (!ev || !guestName.trim()) return;
    setGuestBusy(true);
    setGuestErr(null);
    try {
      const result = await addEventGuest(ev.id, guestName.trim(), guestGender);
      setGuestName("");
      setGuestOpen(false);
      setNote(result.waitlisted ? `${result.name} is on the waiting list — the session is full.` : `${result.name} is in.`);
      load();
    } catch (e) {
      setGuestErr(e instanceof Error ? e.message : "Couldn't add that guest.");
    } finally {
      setGuestBusy(false);
    }
  }

  function dropGuest(guestId: string, who: string) {
    setConfirm({
      title: `Remove ${who}?`,
      // A guest has no account, so this is not reversible by the guest: only
      // whoever invited them can put them back, and by then the spot may be
      // gone.
      body: `${who} was brought as a guest. Removing them frees their spot for the next person waiting, and they'd need adding again from scratch.`,
      confirmLabel: `Remove ${who}`,
      tone: "danger",
      run: () => doDropGuest(guestId, who),
    });
  }

  async function doDropGuest(guestId: string, who: string) {
    setBusy(true);
    setNote(null);
    try {
      await removeEventGuest(guestId);
      setNote(`${who} is out.`);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't remove that guest.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Admin: promote off the waiting list, or take someone out.
   *
   * Promoting is a gift and goes through unchallenged. Taking somebody out is
   * done TO a person who is not holding the phone and cannot object, so it
   * asks first — and says what happens next, because the spot does not stay
   * empty, it moves to whoever is first in the queue.
   */
  function setFor(userId: string, response: RsvpResponse, who: string) {
    if (!ev) return;
    if (response === "in") {
      void doSetFor(userId, response, who);
      return;
    }
    const waiting = ev.counts.waitlist;
    setConfirm({
      title: `Take ${who} out?`,
      body:
        waiting > 0
          ? `${who} is in for this session. Taking them out gives their spot to the next person on the waiting list — you'd have to ask them to answer again, and the night may be full by then.`
          : `${who} is in for this session. They'll need to answer again themselves if this was a mistake.`,
      confirmLabel: `Take ${who} out`,
      tone: "danger",
      run: () => doSetFor(userId, response, who),
    });
  }

  async function doSetFor(userId: string, response: RsvpResponse, who: string) {
    if (!ev) return;
    setBusy(true);
    setNote(null);
    try {
      await setMemberRsvp(ev.id, userId, response);
      setNote(response === "in" ? `${who} is in.` : `${who} is out.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
      load();
    }
  }

  async function share() {
    // window.location.href was `capacitor://localhost/e/...` in the app — a
    // link that opens nothing for anybody. Same path and same message as the
    // club card — see eventShareText. "Copied" only when it really did copy.
    if (!ev) return;
    const outcome = await shareUrl(eventPath(ev), ev.title, eventShareText(ev));
    if (outcome === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  function callOff() {
    if (!ev) return;
    const n = ev.counts.in + ev.counts.waitlist;
    setConfirm({
      title: `Call off ${ev.title}?`,
      body: `${n > 0 ? `${n} ${n === 1 ? "person has" : "people have"} answered. ` : ""}The night is marked cancelled for everyone and answers close. This can't be undone from the app${
        (extras?.paidSpots ?? 0) > 0 ? `, and ${extras?.paidSpots} paid ${extras?.paidSpots === 1 ? "spot needs" : "spots need"} refunding by you` : ""
      }.`,
      confirmLabel: "Call it off",
      tone: "danger",
      run: async () => {
        try {
          await cancelEvent(ev.id);
          setNote("This Call-up is called off.");
        } catch (e) {
          setNote(e instanceof Error ? e.message : "Couldn't call it off.");
        }
        load();
      },
    });
  }

  function startSession() {
    if (!ev) return;
    navigate(`/create?club=${ev.clubId}&name=${encodeURIComponent(ev.title)}&event=${ev.id}`);
  }

  // Full is a real state, not a styling detail: it changes what the In button
  // says, what a tap does, and whether the counts read 8/12 or just 8.
  const full = !!ev && ev.maxPlayers != null && ev.counts.in >= ev.maxPlayers;
  // 0084: Pay to get in. Everyone starts on the waiting list.
  const prepay = extras?.paymentMode === "prepay";
  // Full with no waiting list (Club settings): the In button can't do anything.
  const closedWhenFull = full && !rules.waitlist;
  // Once a session has been started from this event the RSVP list is no longer
  // what decides who plays — the session roster is — so the form comes down.
  // The server refuses the write too (0052).
  const started = !!ev?.session && (ev.session.status === "live" || ev.session.status === "ended");
  const live = ev?.session?.status === "live";
  const myQueuePosition =
    ev && ev.myResponse === "waitlist" ? ev.waitlist.findIndex((p) => p.userId === user?.id) + 1 || null : null;

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 pt-5 pb-10 safe-top safe-bottom anim-fade";
  const roundBtn =
    "w-9 h-9 rounded-full bg-surface text-ink-2 flex items-center justify-center shadow-[0_1px_2px_rgba(13,13,13,0.06)] active:scale-95 transition-transform";
  const cancelled = ev?.status === "cancelled";
  const canRun = !!ev?.isAdmin && !cancelled && !started;
  const bar = (
    <div className="flex items-center justify-between mb-1">
      <button onClick={back} aria-label="Back" className={`${roundBtn} text-[17px]`}>
        ‹
      </button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      {ev?.isAdmin && !cancelled ? (
        <button onClick={() => setMenuOpen(true)} aria-label="Call-up options" className={roundBtn}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      ) : ev && !cancelled ? (
        <button onClick={share} aria-label={copied ? "Link copied" : "Share this Call-up"} className={roundBtn}>
          {copied ? <span className="text-[13px] text-win">✓</span> : <ShareIcon />}
        </button>
      ) : (
        <div className="w-9" />
      )}
    </div>
  );

  if (loading)
    return (
      <div className={shell}>
        {bar}
        <SkeletonScreen label="Loading this session">
          <SkeletonBlock h={250} className="mt-3 mb-4" />
          <SkeletonBlock h={150} className="mb-5" />
          <SkeletonRows n={4} avatar />
        </SkeletonScreen>
      </div>
    );
  if (notFound || !ev)
    return (
      <div className={shell}>
        {bar}
        <p className="text-[13px] text-warm-gray mt-16 text-center">This session isn't available.</p>
      </div>
    );

  const when = whenLine(ev.scheduledAt, ev.durationHours);
  const mapHref = mapsLinkFor(ev.location, extras?.locationUrl);
  const loginHref = `/login?next=${encodeURIComponent(`/e/${eventId}`)}`;
  const payMode = extras?.paymentMode ?? "none";
  const showPayments = ev.isAdmin && !cancelled && extras && payMode !== "none";
  const lists: Record<ListKey, EventAttendee[]> = { going: ev.going, waitlist: ev.waitlist, maybe: ev.maybe, out: ev.out };
  const shown: ListKey = list ?? (ev.going.length === 0 && ev.waitlist.length > 0 ? "waitlist" : "going");
  const manageable = ev.isAdmin && !cancelled && !started;
  const canBringGuest = ev.isMember && !cancelled && !ev.session && rules.maxGuests > 0 && !closedWhenFull;
  const myGuests = [...ev.going, ...ev.waitlist].filter((p) => p.isGuest && p.invitedBy === user?.id).length;

  return (
    <div className={shell}>
      {bar}

      {/* ── Header card ─────────────────────────────────────────────── */}
      <div className={`mt-3 ${card} overflow-hidden`}>
        <div className="px-5 pt-4 pb-4">
          <Link to={`/teams/${ev.clubId}`} className="inline-flex items-center gap-2 rounded-full bg-surface-2 pl-1 pr-3 py-1 active:opacity-70">
            <span className="w-[22px] h-[22px] rounded-full bg-gold-soft text-gold-ink flex items-center justify-center text-[11px] font-serif font-semibold overflow-hidden">
              {ev.teamLogo ? <img src={ev.teamLogo} alt="" className="w-full h-full object-cover" /> : ev.teamName.charAt(0).toUpperCase()}
            </span>
            <span className="text-[12px] font-semibold text-ink-2 truncate max-w-[200px]">{ev.teamName}</span>
          </Link>
          <div className="flex items-center gap-2 mt-3">
            {cancelled ? (
              <span className="rounded-full bg-loss-soft text-loss text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1">Called off</span>
            ) : live ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-court-lime/30 text-graphite text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-win" aria-hidden />
                Playing now
              </span>
            ) : started ? (
              <span className="rounded-full bg-surface-2 text-warm-gray text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1">Finished</span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-warm-gray">Call-up</span>
            )}
            {eventCode(ev) && <span className="font-mono text-[10.5px] font-bold tracking-[0.14em] text-gold-ink">{eventCode(ev)}</span>}
          </div>
          <h1 className={`font-serif text-[26px] font-semibold tracking-tight leading-[1.12] mt-1.5 ${cancelled ? "text-warm-gray line-through" : "text-graphite"}`}>
            {ev.title}
          </h1>

          <div className="mt-3.5 space-y-2.5">
            {when && <InfoRow icon={<ClockIcon />} main={when.day} sub={when.time} />}
            {ev.location && (
              <InfoRow
                icon={<PinIcon size={15} />}
                main={ev.location}
                action={
                  mapHref ? (
                    <a href={mapHref} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[12.5px] font-semibold text-gold-ink active:opacity-70">
                      Open map ›
                    </a>
                  ) : null
                }
              />
            )}
            {(ev.cost || payMode !== "none") && <InfoRow icon={<CoinIcon />} main={ev.cost || "Cost to share"} sub={PAY_LABEL[payMode]} />}
          </div>
        </div>

        {/* The plan, in the three numbers everyone asks for. Only when the
            admin filled them in — a strip of dashes is worse than no strip. */}
        {(ev.courtCount || ev.durationHours || ev.maxPlayers) && (
          <div className="border-t border-line flex divide-x divide-line">
            {ev.courtCount != null && <PlanStat n={ev.courtCount} label={ev.courtCount === 1 ? "Court" : "Courts"} />}
            {ev.durationHours != null && <PlanStat n={Number(ev.durationHours.toFixed(1))} label={ev.durationHours === 1 ? "Hour" : "Hours"} />}
            {ev.maxPlayers != null && <PlanStat n={ev.maxPlayers} label="Players" />}
          </div>
        )}
      </div>

      {/* ── In play, or played. Either way the plan is over. ─────────── */}
      {started && (
        <div className="mt-3.5">
          {live && ev.session?.publicToken ? (
            <Link
              to={`/live/${ev.session.publicToken}${ev.session.joinCode ? `?j=${ev.session.joinCode}` : ""}`}
              className="flex items-center gap-3 rounded-[22px] bg-court-lime/25 px-4 py-4 active:scale-[0.99] transition-transform"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-win shrink-0 animate-pulse" aria-hidden />
              <span className="flex-1 min-w-0">
                <span className="block text-[14.5px] font-semibold text-graphite">This night is being played</span>
                <span className="block text-[12px] text-ink-2 mt-0.5">See the live scoreboard</span>
              </span>
              <span className="text-[18px] text-ink-2" aria-hidden>›</span>
            </Link>
          ) : (
            <div className={`${card} px-4 py-4`}>
              <p className="text-[14px] font-semibold text-graphite">{live ? "This night is being played" : "This night has finished"}</p>
              <p className="text-[12px] text-warm-gray mt-1 leading-snug">Answers are closed — who played is on the session itself now.</p>
              {!live && ev.session && (
                <Link to={`/session/${ev.session.id}/final`} className="inline-block mt-2.5 text-[13px] font-semibold text-gold-ink active:opacity-70">
                  See the results ›
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Paying after the night (0082): what I still owe, on a night that's
          been played. Before the night this lives inside Your spot. */}
      {started && !cancelled && extras?.member && user && payMode !== "none" && ((extras.me?.spots ?? 0) > 0 || extras.me?.paid) && (
        <div className={`mt-3.5 ${card} px-4 pt-4 pb-4`}>
          <span className="block text-[11px] font-semibold text-warm-gray">Your payment</span>
          <span className={`block font-serif text-[20px] font-semibold leading-tight mt-0.5 ${extras.me?.paid ? "text-win" : "text-graphite"}`}>
            {extras.me?.paid ? "All settled" : ev.cost ? `${ev.cost} to pay` : "Still to pay"}
          </span>
          <PlayerPayment eventId={ev.id} myUserId={user.id} extras={extras} amIn onChanged={(x) => (x ? setExtras(x) : load())} />
        </div>
      )}

      {cancelled && (
        <div className="mt-3.5 rounded-[22px] bg-loss-soft px-4 py-4">
          <p className="text-[14px] font-semibold text-loss">This night is called off</p>
          <p className="text-[12px] text-ink-2 mt-1 leading-snug">Nobody needs to come. If you'd paid, sort the refund with the club's admins.</p>
        </div>
      )}

      {/* ── Your spot ───────────────────────────────────────────────── */}
      {!started && !cancelled && ev.isMember && (
        <div className={`mt-3.5 ${card} px-4 pt-4 pb-4`}>
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-warm-gray">Your spot</span>
              <SpotStatus response={ev.myResponse} position={myQueuePosition} full={full} prepay={prepay} hasReceipt={Boolean(extras?.me?.hasReceipt)} />
            </span>
            <span className="text-right shrink-0">
              <span className="block font-mono tnum text-[22px] font-semibold text-graphite leading-none">
                {ev.counts.in}
                {ev.maxPlayers != null && <span className="text-[13px] text-warm-gray">/{ev.maxPlayers}</span>}
              </span>
              <span className="block text-[10.5px] text-warm-gray mt-1">
                {ev.counts.waitlist > 0 ? `in · ${ev.counts.waitlist} waiting` : ev.counts.maybe > 0 ? `in · ${ev.counts.maybe} maybe` : "in"}
              </span>
            </span>
          </div>

          <div className="mt-3.5">
            <Segmented
              label="Your answer"
              value={(ev.myResponse === "waitlist" ? "in" : ev.myResponse ?? "") as RsvpResponse}
              onChange={respond}
              options={RSVP_OPTS.map((o) => ({
                value: o.value,
                // "In" becomes "Join waitlist" when the night is full and you
                // aren't already in it — the label tells the truth BEFORE the tap.
                label:
                  o.value === "in" && ev.myResponse === "waitlist"
                    ? "Waiting"
                    : o.value === "in" && prepay && ev.myResponse !== "in"
                      ? "Join the list"
                    : o.value === "in" && full && ev.myResponse !== "in"
                      ? rules.waitlist
                        ? "Join waitlist"
                        : "Full"
                      : o.label,
              }))}
            />
          </div>
          {prepay && ev.myResponse !== "in" && ev.myResponse !== "waitlist" && (
            <p className="text-[11.5px] text-gold-ink mt-2 px-1">Pay to get in: join the list, then upload your receipt. Spots go in the order receipts arrive.</p>
          )}
          {!prepay && full && ev.myResponse !== "in" && ev.myResponse !== "waitlist" && (
            <p className="text-[11.5px] text-gold-ink mt-2 px-1">
              {rules.waitlist ? "It's full — answering In puts you on the waiting list." : "It's full, and this club doesn't keep a waiting list."}
            </p>
          )}
          {note && <p className="text-[12px] text-ink-2 mt-2.5 px-1 leading-snug">{note}</p>}
          {extras?.member && user && (
            <PlayerPayment
              eventId={ev.id}
              myUserId={user.id}
              extras={extras}
              amIn={ev.myResponse === "in" || (extras.me?.spots ?? 0) > 0}
              waiting={ev.myResponse === "waitlist"}
              onChanged={(x) => (x ? setExtras(x) : load())}
            />
          )}
        </div>
      )}

      {!started && !cancelled && !ev.isMember && (
        <div className="mt-3.5 rounded-[22px] border-[1.5px] border-dashed border-stone px-4 py-5 text-center">
          <p className="text-[13.5px] text-graphite font-semibold">Members-only Call-up</p>
          <p className="text-[12px] text-warm-gray mt-1 leading-snug">
            {ev.counts.in} in{ev.maxPlayers != null ? ` of ${ev.maxPlayers}` : ""}.{" "}
            {user ? `Join ${ev.teamName} to reserve your spot.` : `Sign in and join ${ev.teamName} to answer.`}
          </p>
          <Link
            to={user ? `/teams/${ev.clubId}` : loginHref}
            className="inline-block mt-3 rounded-full bg-graphite text-ivory text-[13px] font-semibold px-6 py-2.5 active:scale-[0.98] transition-transform"
          >
            {user ? `View ${ev.teamName}` : "Sign in"}
          </Link>
        </div>
      )}

      {/* Notes (bank details…), members only. */}
      {!cancelled && extras?.member && extras.notes && <CallupNotes notes={extras.notes} />}

      {/* Bringing someone who isn't on the app. Any member can — "we bring
          friends" is a thing members do. Who brought whom is recorded, and
          they're the one who can take them out again. */}
      {canBringGuest && (
        <button
          onClick={() => {
            setGuestErr(null);
            setGuestOpen(true);
          }}
          className={`w-full mt-3.5 ${card} px-4 py-3.5 flex items-center gap-3 text-left active:bg-surface-2`}
        >
          <span className="w-9 h-9 rounded-full bg-gold-soft text-gold-ink flex items-center justify-center text-[18px] shrink-0" aria-hidden>
            +
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold text-graphite">Bring a guest</span>
            <span className="block text-[11.5px] text-warm-gray">
              {myGuests > 0
                ? `You're bringing ${myGuests} · up to ${rules.maxGuests}`
                : `A friend who isn't on Padelier · ${rules.maxGuests === 1 ? "one" : `up to ${rules.maxGuests}`} each`}
            </span>
          </span>
          <span className="text-[18px] text-stone" aria-hidden>›</span>
        </button>
      )}

      {/* ── Admin: Players | Payments ───────────────────────────────── */}
      {showPayments && (
        <div className="mt-6">
          <Segmented
            label="Manage"
            value={adminTab}
            onChange={(t) => {
              const p = new URLSearchParams(params);
              if (t === "payments") p.set("tab", "payments");
              else p.delete("tab");
              setParams(p, { replace: true });
            }}
            options={[
              { value: "players", label: "Players" },
              {
                value: "payments",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    Payments
                    {toCheck > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-loss text-ivory text-[10px] font-bold inline-flex items-center justify-center">{toCheck}</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      {showPayments && adminTab === "payments" ? (
        <AdminPayments
          eventId={ev.id}
          mode={payMode}
          version={payVersion}
          deadline={extras?.deadline ?? null}
          played={extras?.played ?? false}
          closed={extras?.collectingClosed ?? false}
          onChanged={() => {
            getCallupExtras(ev.id).then(setExtras);
            getClubAdminTodo(ev.clubId).then((t) => setToCheck(t.find((x) => x.eventId === ev.id)?.toCheck ?? 0));
          }}
        />
      ) : (
        <>
          {/* ── Who's coming ─────────────────────────────────────────── */}
          <div className={`flex items-baseline justify-between ${showPayments ? "mt-4" : "mt-6"} px-0.5`}>
            <h2 className="font-serif text-[18px] font-semibold text-graphite">Players</h2>
            <PaidCount extras={extras} />
          </div>
          <div className="flex gap-1.5 mt-2.5 overflow-x-auto no-scrollbar -mx-5 px-5">
            {(
              [
                ["going", "Going"],
                ["waitlist", "Waiting"],
                ["maybe", "Maybe"],
                ["out", "Out"],
              ] as [ListKey, string][]
            )
              .filter(([k]) => k === "going" || lists[k].length > 0)
              .map(([k, label]) => {
                const on = shown === k;
                return (
                  <button
                    key={k}
                    onClick={() => setList(k)}
                    aria-pressed={on}
                    className={`shrink-0 h-8 px-3.5 rounded-full text-[12.5px] font-semibold transition-colors ${
                      on ? "bg-graphite text-ivory" : "bg-surface text-ink-2 shadow-[0_1px_2px_rgba(13,13,13,0.05)]"
                    }`}
                  >
                    {label} <span className={`font-mono tnum ${on ? "text-ivory/70" : "text-warm-gray"}`}>{lists[k].length}</span>
                  </button>
                );
              })}
          </div>
          {shown === "going" && full && !cancelled && !started && (
            <p className="text-[11.5px] text-gold-ink mt-2 px-1">Full. Anyone joining now goes on the waiting list.</p>
          )}
          {lists[shown].length === 0 ? (
            <p className="text-[12.5px] text-warm-gray text-center mt-6">{shown === "going" ? "Nobody's in yet." : "No one here."}</p>
          ) : (
            <div className={`mt-2.5 ${card} overflow-hidden`}>
              {/* Going is alphabetical because it's a roster you scan for a
                  name; the waiting list is in the order people asked, because
                  there the order IS the information. */}
              {lists[shown].map((p, i) => {
                const mine = p.isGuest && !!user && p.invitedBy === user.id;
                const rowBody = (
                  <>
                    {shown === "waitlist" && <span className="font-mono tnum text-[12px] font-semibold text-warm-gray w-4 shrink-0">{i + 1}</span>}
                    <Face name={p.displayName} url={p.avatarUrl} size={34} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-semibold text-graphite truncate">
                        {p.displayName}
                        {p.userId === user?.id && <span className="font-normal text-warm-gray"> · you</span>}
                      </span>
                      {p.isGuest && <span className="block text-[11px] text-warm-gray">{mine ? "Your guest" : "Guest"}</span>}
                    </span>
                  </>
                );
                const rowCls = "flex items-center gap-3 px-3.5 py-2.5 border-t border-line first:border-t-0";
                // Admin rows open the Manage sheet; the controls live there,
                // away from the profile tap — a mis-tap that removes someone
                // from Monday's session is not one you take back quietly.
                if (manageable && (p.isGuest || shown !== "out")) {
                  return (
                    <button key={p.userId} onClick={() => setManaging({ p, list: shown })} disabled={busy} className={`${rowCls} w-full text-left active:bg-surface-2`}>
                      {rowBody}
                      <span className="text-[11.5px] font-semibold text-warm-gray shrink-0">Manage</span>
                    </button>
                  );
                }
                if (p.isGuest) {
                  return (
                    <div key={p.userId} className={rowCls}>
                      {rowBody}
                      {mine && !cancelled && !started && (
                        <button
                          onClick={() => dropGuest(p.guestId!, p.displayName)}
                          disabled={busy}
                          className="shrink-0 text-[11.5px] font-semibold text-warm-gray bg-surface-2 rounded-full px-3 py-1.5 active:opacity-70 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                }
                return (
                  <Link key={p.userId} to={`/u/${p.userId}`} className={`${rowCls} active:bg-surface-2`}>
                    {rowBody}
                    <span className="text-stone text-[16px]" aria-hidden>›</span>
                  </Link>
                );
              })}
            </div>
          )}
          {ev.isAdmin && note && (!ev.isMember || started || cancelled) && <p className="text-[12px] text-ink-2 mt-3 px-1">{note}</p>}
        </>
      )}

      {/* ── Sheets. Portalled out of this tree by Sheet — see the note in
          Sheet.tsx about anim-fade creating a stacking context. ───────── */}
      {menuOpen && (
        <BottomSheet onClose={() => setMenuOpen(false)} title={ev.title} variant="card">
          <div className="rounded-[16px] bg-surface-2 overflow-hidden">
            {canRun && (
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  startSession();
                }}
                strong
              >
                Start the session
                {ev.counts.in > 0 && <span className="block text-[11.5px] font-normal text-warm-gray">The {ev.counts.in} who are in are added for you</span>}
              </MenuItem>
            )}
            {canRun && (
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  setEditing(true);
                }}
              >
                Edit details &amp; payment
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                void share();
              }}
            >
              Share the link
            </MenuItem>
            {canRun && (
              <MenuItem
                danger
                onClick={() => {
                  setMenuOpen(false);
                  callOff();
                }}
              >
                Call off this night
              </MenuItem>
            )}
          </div>
          <button onClick={() => setMenuOpen(false)} className="w-full text-[14px] font-semibold text-warm-gray py-3 mt-1.5">
            Cancel
          </button>
        </BottomSheet>
      )}

      {managing && (
        <BottomSheet onClose={() => setManaging(null)} title={managing.p.displayName} subtitle={manageSubtitle(managing.list, managing.p)} variant="card">
          <div className="rounded-[16px] bg-surface-2 overflow-hidden">
            {!managing.p.isGuest && (
              <Link to={`/u/${managing.p.userId}`} className="block px-4 py-3.5 text-[14px] text-graphite">
                View profile
              </Link>
            )}
            {!managing.p.isGuest && (managing.list === "waitlist" || managing.list === "maybe") && (
              <MenuItem
                strong
                onClick={() => {
                  const p = managing.p;
                  setManaging(null);
                  setFor(p.userId, "in", p.displayName);
                }}
              >
                Move in
              </MenuItem>
            )}
            {!managing.p.isGuest && managing.list === "going" && (
              <MenuItem
                danger
                onClick={() => {
                  const p = managing.p;
                  setManaging(null);
                  setFor(p.userId, "out", p.displayName);
                }}
              >
                Take out
              </MenuItem>
            )}
            {managing.p.isGuest && managing.p.guestId && (
              <MenuItem
                danger
                first
                onClick={() => {
                  const p = managing.p;
                  setManaging(null);
                  dropGuest(p.guestId!, p.displayName);
                }}
              >
                Remove guest
              </MenuItem>
            )}
          </div>
          <button onClick={() => setManaging(null)} className="w-full text-[14px] font-semibold text-warm-gray py-3 mt-1.5">
            Cancel
          </button>
        </BottomSheet>
      )}

      {guestOpen && (
        <BottomSheet onClose={() => setGuestOpen(false)} title="Bring a guest" subtitle="Someone who isn't on Padelier. They take a place like anyone else.">
          <div className="flex gap-2">
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addGuest();
              }}
              placeholder="Their name"
              maxLength={40}
              autoFocus
              className="flex-1 min-w-0 h-12 rounded-full bg-surface-2 px-4 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/40"
            />
            {/* Gender, because the Mix formats can't draw a round without it —
                and asking here is the only moment anyone knows the answer. */}
            <div className="w-[104px] shrink-0">
              <Segmented
                label="Guest's gender"
                value={guestGender}
                onChange={setGuestGender}
                options={[
                  { value: "M", label: "M" },
                  { value: "F", label: "F" },
                ]}
              />
            </div>
          </div>
          <p className="text-[11.5px] text-warm-gray mt-2.5 px-1 leading-snug">
            {rules.maxGuests === 1 ? "One guest each." : `Up to ${rules.maxGuests} guests each.`}
            {prepay ? " They wait on the list and come in with you when your receipt is accepted." : full ? " It's full, so they'll join the waiting list." : ""} You can take them out again from the list.
          </p>
          {guestErr && <p className="text-[12px] text-loss mt-2 px-1">{guestErr}</p>}
          <button
            onClick={() => void addGuest()}
            disabled={guestBusy || guestName.trim().length === 0}
            className="w-full h-12 mt-4 rounded-full bg-graphite text-ivory text-[14px] font-semibold active:scale-[0.99] transition-transform disabled:opacity-40"
          >
            {guestBusy ? "Adding…" : full || prepay ? "Add to the waiting list" : "Add guest"}
          </button>
        </BottomSheet>
      )}

      {editing && (
        <CallupFormSheet
          clubId={ev.clubId}
          events={[]}
          editing={{
            id: ev.id,
            title: ev.title,
            scheduledAt: ev.scheduledAt,
            location: ev.location,
            locationUrl: extras?.locationUrl ?? null,
            courtCount: ev.courtCount,
            durationHours: ev.durationHours,
            maxPlayers: ev.maxPlayers,
            cost: ev.cost,
            paymentMode: payMode,
            notes: extras?.notes ?? null,
            inCount: ev.counts.in,
          }}
          onClose={() => setEditing(false)}
          onSaved={(_id, warning) => {
            setEditing(false);
            setNote(warning ?? "Saved.");
            load();
          }}
        />
      )}

      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function manageSubtitle(list: ListKey, p: EventAttendee): string {
  const where = list === "going" ? "In" : list === "waitlist" ? "On the waiting list" : list === "maybe" ? "Maybe" : "Out";
  return p.isGuest ? `${where} · guest` : where;
}

function SpotStatus({
  response,
  position,
  full,
  prepay = false,
  hasReceipt = false,
}: {
  response: RsvpResponse | null;
  position: number | null;
  full: boolean;
  prepay?: boolean;
  hasReceipt?: boolean;
}) {
  const [text, cls] =
    response === "in"
      ? ["You're in", "text-win"]
      : response === "waitlist" && prepay
        ? [hasReceipt ? "Receipt being checked" : "On the list · pay to get in", "text-gold-ink"]
      : response === "waitlist"
        ? [position ? `Waiting · number ${position}` : "On the waiting list", "text-gold-ink"]
        : response === "maybe"
          ? ["Maybe", "text-gold-ink"]
          : response === "out"
            ? ["You're out", "text-warm-gray"]
            : [full ? "Not answered · it's full" : "Not answered yet", "text-graphite"];
  return <span className={`block font-serif text-[20px] font-semibold leading-tight mt-0.5 ${cls}`}>{text}</span>;
}

function InfoRow({ icon, main, sub, action }: { icon: ReactNode; main: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-8 h-8 rounded-full bg-surface-2 text-ink-2 flex items-center justify-center shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 min-w-0 pt-[1px]">
        <span className="block text-[14px] font-semibold text-graphite leading-snug break-words">{main}</span>
        {sub && <span className="block font-mono tnum text-[12px] text-warm-gray mt-0.5">{sub}</span>}
      </span>
      {action && <span className="pt-1.5">{action}</span>}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
  strong,
  first,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  strong?: boolean;
  first?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 text-[14px] ${first ? "" : "border-t border-line first:border-t-0"} ${
        danger ? "text-loss" : strong ? "font-semibold text-graphite" : "text-graphite"
      } active:bg-line/40`}
    >
      {children}
    </button>
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

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
function CoinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
