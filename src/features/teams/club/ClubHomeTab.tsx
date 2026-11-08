import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Team, TeamMember, TeamSession } from "../../../lib/supabase/teamQueries";
import type { JoinRequestItem } from "../../../lib/supabase/clubJoinQueries";
import {
  AdminTodoItem,
  CallupExtras,
  ClubMoney,
  getClubMoney,
  ClubEvent,
  RsvpResponse,
  eventCode,
  eventPath,
  eventShareText,
  getCallupExtras,
  getClubAdminTodo,
  setRsvp,
} from "../../../lib/supabase/eventQueries";
import { shareUrl } from "../../../lib/shareLink";
import { finalizeMissedClubNights, MissedNight } from "../../../lib/supabase/resultActions";
import ConfirmSheet, { ConfirmRequest } from "../../shell/ConfirmSheet";
import { Chevron, CrownIcon, DateTile, SectionHead, card, raisedCard } from "./ui";

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function timeLeft(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0)) return null;
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h left` : `${Math.floor(h / 24)} days left`;
}

const ANSWERS: { value: RsvpResponse; label: string }[] = [
  { value: "in", label: "I'm in" },
  { value: "maybe", label: "Maybe" },
  { value: "out", label: "Can't make it" },
];

/**
 * The Club tab (ADR-002): what needs doing, the next night, what's coming,
 * and who won last time. Nothing else; the rest lives in the other tabs.
 */
export default function ClubHomeTab({
  team,
  members,
  isAdmin,
  events,
  eventsLoaded,
  onEventsChanged,
  mutateEvents,
  past,
  requests,
  onDecide,
  busyReq,
  onNewCallup,
  onInvite,
  userId,
  onLeagueChanged,
}: {
  team: Team;
  members: TeamMember[];
  isAdmin: boolean;
  events: ClubEvent[];
  eventsLoaded: boolean;
  onEventsChanged: () => void;
  mutateEvents: (fn: (prev: ClubEvent[]) => ClubEvent[]) => void;
  past: TeamSession[];
  requests: JoinRequestItem[];
  onDecide: (requestId: string, accept: boolean) => void;
  busyReq: string | null;
  onNewCallup: () => void;
  onInvite: () => void;
  userId?: string;
  /** A missed night was just saved to the league. */
  onLeagueChanged?: () => void;
}) {
  const navigate = useNavigate();
  const live = events.filter((e) => e.isLive);
  const upcoming = events.filter((e) => !e.isLive);
  const next = upcoming[0] ?? null;
  const later = upcoming.slice(1, 6);
  const now = new Date();
  const nextIsToday = next ? sameDay(new Date(next.scheduledAt), now) : false;

  // The next night's payment picture (0080), and the admin's to-do (0081).
  const [extras, setExtras] = useState<CallupExtras | null>(null);
  const [todo, setTodo] = useState<AdminTodoItem[]>([]);
  const nextId = next?.id ?? null;
  useEffect(() => {
    let alive = true;
    setExtras(null);
    if (nextId) getCallupExtras(nextId).then((x) => alive && setExtras(x));
    return () => {
      alive = false;
    };
  }, [nextId, next?.myResponse]);
  useEffect(() => {
    let alive = true;
    if (isAdmin) getClubAdminTodo(team.id).then((t) => alive && setTodo(t));
    return () => {
      alive = false;
    };
  }, [isAdmin, team.id, events.length]);

  // Nights of mine that ended but never reached the league: save them now,
  // and show only the ones that still fail.
  const [missed, setMissed] = useState<MissedNight[]>([]);
  const [retrying, setRetrying] = useState(false);
  async function catchUp(announce: boolean) {
    if (!isAdmin || !userId) return;
    if (announce) setRetrying(true);
    try {
      const r = await finalizeMissedClubNights(team.id, userId);
      setMissed(r.missed);
      if (r.saved > 0) onLeagueChanged?.();
    } finally {
      setRetrying(false);
    }
  }
  useEffect(() => {
    void catchUp(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, userId, team.id]);

  // Played nights with money still out (0082): admins collect, players owe.
  const [money, setMoney] = useState<ClubMoney>({ collect: [], owe: [] });
  useEffect(() => {
    let alive = true;
    getClubMoney(team.id).then((m) => alive && setMoney(m));
    return () => {
      alive = false;
    };
  }, [team.id, events.length, live.length]);

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  function answer(ev: ClubEvent, response: RsvpResponse) {
    const leavingSpot = ev.myResponse === "in" && response !== "in";
    const leavingQueue = ev.myResponse === "waitlist" && response !== "in" && response !== "waitlist";
    if (!leavingSpot && !leavingQueue) {
      void doAnswer(ev.id, response);
      return;
    }
    const waiting = ev.counts.waitlist;
    const paid = ev.id === nextId && extras?.me?.paid;
    setConfirm(
      leavingSpot && paid
        ? {
            title: "You've already paid",
            body: `You're marked as paid for ${ev.title}. Leaving gives up your spot${waiting > 0 ? " to the next person waiting" : ""}, and the app doesn't return the money: the admins will be told, so sort out a refund with them.`,
            confirmLabel: response === "out" ? "Yes, I'm out" : "Change me to maybe",
            tone: "danger",
            run: () => doAnswer(ev.id, response),
          }
        : leavingSpot
          ? {
              title: "Give up your spot?",
              body:
                waiting > 0
                  ? `You're in for ${ev.title}. Leaving hands your spot straight to the next person waiting${waiting > 1 ? ` (${waiting} are in the queue)` : ""}. If you change your mind you'd rejoin at the back.`
                  : `You're in for ${ev.title}. You can answer again later, though if it fills up meanwhile you'd join the waiting list.`,
              confirmLabel: response === "out" ? "Yes, I'm out" : "Change me to maybe",
              tone: "danger",
              run: () => doAnswer(ev.id, response),
            }
          : {
              title: "Leave the waiting list?",
              body: `Leaving gives up your place in the queue for ${ev.title}. Rejoining later starts you at the back.`,
              confirmLabel: "Leave the waiting list",
              tone: "danger",
              run: () => doAnswer(ev.id, response),
            },
    );
  }

  async function doAnswer(eventId: string, response: RsvpResponse) {
    // Optimistic, and through the cache, so leaving and coming back before
    // the server answers doesn't show the old answer.
    mutateEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, myResponse: response } : e)));
    try {
      await setRsvp(eventId, response);
    } catch {
      /* the reload corrects it */
    }
    onEventsChanged();
  }

  // ── Needs you (admins) ──────────────────────────────────────────────────
  const thinNights = isAdmin
    ? upcoming.filter((e) => {
        const ms = new Date(e.scheduledAt).getTime() - Date.now();
        return e.maxPlayers != null && e.maxPlayers > 0 && ms > 0 && ms < 3 * 86400000 && e.counts.in < e.maxPlayers / 2;
      })
    : [];
  const collect = isAdmin ? money.collect : [];
  const collectIds = new Set(collect.map((c) => c.eventId));
  const todoNow = todo.filter((t) => !collectIds.has(t.eventId));
  const needsCount = missed.length + collect.length + todoNow.length + requests.length + thinNights.length;

  // ── Getting started (admins of a new club) ─────────────────────────────
  const hideKey = `padelier:club:${team.id}:setupHidden`;
  const [setupHidden, setSetupHidden] = useState(() => {
    try {
      return localStorage.getItem(hideKey) === "1";
    } catch {
      return false;
    }
  });
  const usual = team.settings?.callupDefaults;
  const steps = [
    { key: "create", label: "Create the club", done: true },
    { key: "logo", label: "Add a logo", done: Boolean(team.logoUrl), hint: "Tap the logo at the top" },
    {
      key: "invite",
      label: "Invite 4 players",
      done: members.length >= 4,
      hint: `${Math.min(members.length, 4)} of 4 · enough for one court`,
      action: { label: "Invite", run: onInvite, primary: true },
    },
    {
      key: "usual",
      label: "Set your usual night",
      done: typeof usual?.weekday === "number" && Boolean(usual?.time),
      hint: "Day, venue and payment, so Call-ups fill themselves in",
      action: { label: "Set", run: () => navigate(`/teams/${team.id}/settings`) },
    },
    {
      key: "callup",
      label: "Post your first Call-up",
      done: events.length > 0 || past.length > 0,
      hint: "Everyone gets a notification to answer",
      action: { label: "Post", run: onNewCallup },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const showSetup = isAdmin && !setupHidden && doneCount < steps.length && past.length < 3;

  const full = (e: ClubEvent) => e.maxPlayers != null && e.counts.in >= e.maxPlayers;
  const waitlistOn = team.settings?.waitlistEnabled !== false;
  const lastNight = past[0] ?? null;

  return (
    <div className="px-5">
      {/* Playing now */}
      {live.map((ev) => (
        <div key={ev.id} className={`mt-5 ${raisedCard} overflow-hidden`}>
          <div className="bg-court-lime/25 px-4 pt-4 pb-3.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1">
                <span className="w-[7px] h-[7px] rounded-full bg-[#8FB01E] shadow-[0_0_0_4px_rgba(196,226,75,0.4)]" aria-hidden />
                <span className="text-[10px] font-bold tracking-[0.14em] text-graphite">LIVE NOW</span>
              </span>
              {ev.liveCode && (
                <span className="font-mono text-[12px] font-semibold text-ink-2">
                  Code <b className="text-graphite tracking-[0.08em]">{ev.liveCode}</b>
                </span>
              )}
            </div>
            <p className="font-serif text-[22px] font-semibold text-graphite mt-3">{ev.title}</p>
            <p className="text-[12.5px] text-ink-2 mt-0.5">Being played{ev.location ? ` at ${ev.location}` : ""}</p>
          </div>
          <div className="p-4 pt-3">
            <Link
              to={`/live/${ev.liveToken}${ev.liveCode ? `?j=${ev.liveCode}` : ""}`}
              className="flex items-center justify-center h-[46px] rounded-full bg-graphite text-ivory text-[14px] font-semibold active:scale-[0.99] transition-transform"
            >
              Watch the scoreboard
            </Link>
          </div>
        </div>
      ))}

      {/* What I still owe for nights already played */}
      {money.owe.map((o) => (
        <Link
          key={"o" + o.eventId}
          to={eventPath({ id: o.eventId, slug: o.slug })}
          className={`mt-5 flex items-center gap-3 rounded-[22px] px-4 py-3.5 active:opacity-80 ${o.hasReceipt ? "bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04)]" : "bg-gold-soft"}`}
        >
          <NeedIcon kind="money" />
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold text-graphite truncate">
              {o.hasReceipt ? "Receipt sent" : "You still owe"} · {o.title}
            </span>
            <span className="block text-[11.5px] text-ink-2 truncate">
              {dayLabel(o.scheduledAt)}
              {o.cost ? ` · ${o.cost}` : ""}
              {o.spots > 1 ? ` · ${o.spots} spots` : ""}
              {o.hasReceipt ? " · waiting for an admin" : o.paymentMode === "receipt" ? " · upload your receipt" : " · pay as the notes say"}
            </span>
          </span>
          <Chevron />
        </Link>
      ))}

      {/* Needs you */}
      {isAdmin && needsCount > 0 && (
        <>
          <p className="text-[12px] font-semibold text-loss mt-5 px-0.5">Needs you · {needsCount}</p>
          <div className={`mt-2 ${card} px-3.5`}>
            {missed.map((m) => (
              <div key={"x" + m.sessionId} className="flex items-center gap-3 py-3 border-t border-line first:border-t-0">
                <NeedIcon kind="calendar" />
                <span className="flex-1 min-w-0 text-[13.5px]">
                  <b className="font-semibold text-graphite">{m.name}</b>
                  <span className="text-warm-gray"> isn't in the league yet</span>
                  <span className="block text-[11.5px] text-loss leading-snug mt-0.5">{m.reason}</span>
                </span>
                <button
                  onClick={() => void catchUp(true)}
                  disabled={retrying}
                  className="shrink-0 rounded-full bg-gold-soft text-gold-ink text-[12px] font-bold px-3 py-1.5 disabled:opacity-40"
                >
                  {retrying ? "Saving…" : "Try again"}
                </button>
              </div>
            ))}
            {collect.map((c) => (
              <Link key={"c" + c.eventId} to={`${eventPath({ id: c.eventId, slug: c.slug })}?tab=payments`} className="flex items-center gap-3 py-3 border-t border-line first:border-t-0">
                <NeedIcon kind="money" />
                <span className="flex-1 min-w-0 text-[13.5px]">
                  <b className="font-semibold text-graphite">Still to collect</b>
                  <span className="text-warm-gray">
                    {" "}
                    · {dayLabel(c.scheduledAt)} · {c.paidSpots} of {c.inSpots} paid{c.toCheck > 0 ? ` · ${c.toCheck} to check` : ""}
                  </span>
                </span>
                <Chevron />
              </Link>
            ))}
            {todoNow.map((t) => (
              <Link key={t.eventId} to={`/e/${t.eventId}?tab=payments`} className="flex items-center gap-3 py-3 border-t border-line first:border-t-0">
                <NeedIcon kind="money" />
                <span className="flex-1 min-w-0 text-[13.5px]">
                  <b className="font-semibold text-graphite">
                    {t.toCheck} {t.toCheck === 1 ? "receipt" : "receipts"} to check
                  </b>
                  <span className="text-warm-gray"> · {sameDay(new Date(t.scheduledAt), now) ? "Tonight" : t.title}</span>
                </span>
                <Chevron />
              </Link>
            ))}
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-3 border-t border-line first:border-t-0">
                <NeedIcon kind="person" />
                <span className="flex-1 min-w-0 text-[13.5px] truncate">
                  <b className="font-semibold text-graphite">{r.displayName}</b>
                  <span className="text-warm-gray"> wants to join</span>
                </span>
                <button
                  onClick={() => onDecide(r.id, true)}
                  disabled={busyReq === r.id}
                  className="shrink-0 rounded-full bg-win-soft text-win text-[12px] font-bold px-3 py-1.5 disabled:opacity-40"
                >
                  Accept
                </button>
              </div>
            ))}
            {thinNights.map((e) => (
              <button
                key={e.id}
                onClick={() => void shareUrl(eventPath(e), e.title, eventShareText(e))}
                className="w-full flex items-center gap-3 py-3 border-t border-line first:border-t-0 text-left"
              >
                <NeedIcon kind="calendar" />
                <span className="flex-1 min-w-0 text-[13.5px]">
                  <b className="font-semibold text-graphite">
                    {dayLabel(e.scheduledAt)} is {e.counts.in}/{e.maxPlayers}
                  </b>
                  <span className="text-warm-gray"> · share it again?</span>
                </span>
                <Chevron />
              </button>
            ))}
          </div>
        </>
      )}

      {/* Getting started */}
      {showSetup && (
        <div className={`mt-5 ${raisedCard} p-[18px]`}>
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-[20px] font-semibold text-graphite">Get your club going</h2>
            <span className="font-mono tnum text-[13px] font-semibold text-gold-ink">
              {doneCount}/{steps.length}
            </span>
          </div>
          <div className="h-[5px] rounded-full bg-[#EFEBE4] overflow-hidden mt-3">
            <div className="h-full rounded-full bg-gold" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <div className="mt-2">
            {steps.map((s) => (
              <div key={s.key} className="flex items-center gap-3 py-3 border-t border-line first:border-t-0">
                {s.done ? (
                  <span className="w-[26px] h-[26px] rounded-full bg-win flex items-center justify-center shrink-0" aria-label="Done">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 19 7" /></svg>
                  </span>
                ) : (
                  <span className="w-[26px] h-[26px] rounded-full border-2 border-stone shrink-0" aria-label="To do" />
                )}
                <span className="flex-1 min-w-0">
                  <span className={`block text-[14px] ${s.done ? "text-warm-gray line-through" : "font-semibold text-graphite"}`}>{s.label}</span>
                  {!s.done && s.hint && <span className="block text-[11.5px] text-warm-gray mt-0.5">{s.hint}</span>}
                </span>
                {!s.done && s.action && (
                  <button
                    onClick={s.action.run}
                    className={`shrink-0 rounded-full text-[12.5px] font-semibold px-3.5 py-1.5 ${s.action.primary ? "bg-graphite text-ivory" : "bg-gold-soft text-gold-ink"}`}
                  >
                    {s.action.label}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              setSetupHidden(true);
              try {
                localStorage.setItem(hideKey, "1");
              } catch {
                /* fine: it just shows again next time */
              }
            }}
            className="w-full text-center text-[12px] font-semibold text-warm-gray mt-1 pt-2"
          >
            Hide this
          </button>
        </div>
      )}

      {/* The next night */}
      {next && (
        <>
          <div className="flex items-baseline justify-between mt-6 px-0.5">
            <p className="text-[12px] font-semibold text-gold-ink">
              {nextIsToday ? `Tonight · ${hhmm(next.scheduledAt)}` : `Next · ${dayLabel(next.scheduledAt)} · ${hhmm(next.scheduledAt)}`}
            </p>
            {isAdmin && (
              <button onClick={onNewCallup} className="text-[12.5px] font-semibold text-gold-ink active:opacity-70">
                + New Call-up
              </button>
            )}
          </div>
          <div className={`mt-2 ${raisedCard} p-[18px]`}>
            <Link to={eventPath(next)} className="flex items-baseline justify-between gap-3 active:opacity-80">
              <span className="min-w-0">
                <span className="font-serif text-[22px] font-semibold text-graphite">{next.title}</span>
                {eventCode(next) && <span className="ml-2 font-mono text-[10.5px] font-semibold tracking-[0.08em] text-gold-ink">{eventCode(next)}</span>}
              </span>
              <span className="font-mono tnum text-[13px] font-semibold text-graphite shrink-0">
                {next.counts.in}
                {next.maxPlayers ? <span className="text-warm-gray">/{next.maxPlayers}</span> : <span className="text-warm-gray"> in</span>}
              </span>
            </Link>
            <p className="text-[13px] text-warm-gray mt-1 truncate">
              {[next.location, next.cost, next.counts.waitlist > 0 ? `${next.counts.waitlist} waiting` : null].filter(Boolean).join(" · ") || "Tap for details"}
            </p>
            {next.maxPlayers != null && (
              <div className="h-1 rounded-full bg-[#EFEBE4] overflow-hidden mt-3.5">
                <div className={`h-full rounded-full ${full(next) ? "bg-gold" : "bg-win"}`} style={{ width: `${Math.min(100, (next.counts.in / next.maxPlayers) * 100)}%` }} />
              </div>
            )}

            <div role="radiogroup" aria-label="Your answer" className="flex p-[3px] rounded-full bg-[#EFEBE4] mt-3.5">
              {ANSWERS.map((o) => {
                const on = next.myResponse === o.value || (o.value === "in" && next.myResponse === "waitlist");
                const prepayNext = next.paymentMode === "prepay";
                const label =
                  o.value === "in" && prepayNext && next.myResponse !== "in"
                    ? next.myResponse === "waitlist"
                      ? "On the list"
                      : "Join the list"
                    : o.value === "in" && full(next) && next.myResponse !== "in"
                      ? next.myResponse === "waitlist"
                        ? "Waiting"
                        : waitlistOn
                          ? "Join waitlist"
                          : "Full"
                      : o.label;
                return (
                  <button
                    key={o.value}
                    role="radio"
                    aria-checked={on}
                    onClick={() => answer(next, o.value)}
                    className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold transition-colors ${on ? "bg-surface text-graphite shadow-[0_1px_3px_rgba(13,13,13,0.12)]" : "text-warm-gray"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <PayStrip ev={next} extras={extras} isAdmin={isAdmin} todo={todo.find((t) => t.eventId === next.id) ?? null} />

            {isAdmin && nextIsToday && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => navigate(`/create?club=${team.id}&name=${encodeURIComponent(next.title)}&event=${next.id}`)}
                  className="flex-1 h-[46px] rounded-full bg-graphite text-ivory text-[14px] font-semibold active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="7 4 20 12 7 20" /></svg>
                  Start the session
                </button>
                <Link to={eventPath(next)} className="h-[46px] px-4 rounded-full bg-gold-soft text-gold-ink text-[13.5px] font-semibold flex items-center">
                  Open
                </Link>
              </div>
            )}
            {isAdmin && nextIsToday && next.counts.in > 0 && (
              <p className="text-[11px] text-warm-gray text-center mt-1.5">
                Tonight's {next.counts.in} {next.counts.in === 1 ? "player is" : "players are"} added for you.
              </p>
            )}
          </div>
        </>
      )}

      {/* Nothing posted yet */}
      {eventsLoaded && !next && live.length === 0 && (
        <>
          <SectionHead
            title="Coming up"
            action={
              isAdmin ? (
                <button onClick={onNewCallup} className="text-[12.5px] font-semibold text-gold-ink">
                  + New Call-up
                </button>
              ) : undefined
            }
          />
          <div className="mt-2.5 rounded-[22px] border-[1.5px] border-dashed border-stone px-5 py-6 text-center">
            <p className="text-[13.5px] font-semibold text-ink-2">No Call-ups yet</p>
            <p className="text-[12px] text-warm-gray mt-1">{isAdmin ? "Post one and members can answer I'm in." : "When an admin posts one, it shows here."}</p>
          </div>
        </>
      )}

      {/* Coming up */}
      {later.length > 0 && (
        <>
          <SectionHead title="Coming up" />
          <div className={`mt-2.5 ${card} px-4`}>
            {later.map((e) => (
              <Link key={e.id} to={eventPath(e)} className="flex items-center gap-3.5 py-3.5 border-t border-line first:border-t-0 active:opacity-80">
                <DateTile iso={e.scheduledAt} tone="plain" />
                <span className="flex-1 min-w-0">
                  <b className="block text-[14.5px] font-semibold text-graphite truncate">{e.title}</b>
                  <span className="block text-[12px] text-warm-gray mt-0.5">
                    {hhmm(e.scheduledAt)} · {e.maxPlayers ? `${e.counts.in}/${e.maxPlayers}${full(e) ? " full" : " in"}` : `${e.counts.in} in`}
                  </span>
                </span>
                <AnswerChip ev={e} />
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Last night, in one line; the rest is in Champions */}
      {lastNight && (
        <Link
          to={`/session/${lastNight.id}/final`}
          className="mt-3.5 flex items-center gap-2.5 rounded-[18px] bg-gold-soft px-4 py-3 active:opacity-80"
        >
          <CrownIcon />
          <span className="flex-1 min-w-0 text-[13px] text-graphite truncate">
            {lastNight.winnerName ? (
              <>
                Last time <b className="font-semibold">{lastNight.winnerName}</b> won {lastNight.name}
              </>
            ) : (
              <>Last time: {lastNight.name}</>
            )}
          </span>
          <span className="text-[12px] font-semibold text-gold-ink shrink-0">Results ›</span>
        </Link>
      )}

      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function AnswerChip({ ev }: { ev: ClubEvent }) {
  const r = ev.myResponse;
  if (r === "in") return <span className="text-[12px] font-semibold text-win shrink-0">You're in</span>;
  if (r === "waitlist") return <span className="text-[12px] font-semibold text-gold-ink shrink-0">Waiting</span>;
  if (r === "maybe") return <span className="text-[12px] text-warm-gray shrink-0">Maybe</span>;
  if (r === "out") return <span className="text-[12px] text-warm-gray shrink-0">Out</span>;
  return <span className="text-[12px] text-warm-gray shrink-0">Not answered</span>;
}

/** One line about money on the next night. Players: their own status.
 *  Admins: how many paid and what's waiting. Nothing when there's no payment. */
function PayStrip({ ev, extras, isAdmin, todo }: { ev: ClubEvent; extras: CallupExtras | null; isAdmin: boolean; todo: AdminTodoItem | null }) {
  if (!extras || !extras.member || extras.paymentMode === "none") return null;
  const box = "flex items-center gap-2.5 mt-3 rounded-[16px] px-3 py-2.5";
  if (isAdmin) {
    return (
      <Link to={`/e/${ev.id}?tab=payments`} className={`${box} bg-gold-soft`}>
        <MoneyIcon />
        <span className="flex-1 min-w-0 text-[12px] text-ink-2">
          Payments <b className="font-semibold text-graphite">{extras.paidSpots} of {extras.inSpots} paid</b>
          {todo && todo.toCheck > 0 ? ` · ${todo.toCheck} to check` : ""}
        </span>
        <span className="text-[12px] font-bold text-gold-ink shrink-0">Check ›</span>
      </Link>
    );
  }
  const me = extras.me;
  const iAmIn = ev.myResponse === "in" || (me?.spots ?? 0) > 0;
  // 0084: Pay to get in, still on the list.
  if (extras.paymentMode === "prepay" && !iAmIn && ev.myResponse === "waitlist") {
    return (
      <Link to={eventPath(ev)} className={`${box} ${me?.rejectedReason && !me.hasReceipt ? "bg-loss-soft" : "bg-gold-soft"}`}>
        <MoneyIcon />
        <span className="flex-1 min-w-0 text-[12.5px] text-ink-2">
          {me?.hasReceipt ? (
            <>Receipt sent{extras.checkPosition ? ` · #${extras.checkPosition} to check` : ""} · you're in once it's accepted</>
          ) : me?.rejectedReason ? (
            <>Receipt not accepted · upload a new one</>
          ) : extras.uploadOpen ? (
            <>On the list · upload your receipt to get a spot</>
          ) : (
            <>On the list · every spot is taken or being checked</>
          )}
        </span>
        {!me?.hasReceipt && extras.uploadOpen && <span className="shrink-0 rounded-full bg-gold text-graphite text-[12px] font-bold px-3 py-1.5">Pay</span>}
      </Link>
    );
  }
  if (!me || !iAmIn) return null;
  if (me.paid) {
    return (
      <div className={`${box} bg-win-soft`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#27754A" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="5 12 10 17 19 7" /></svg>
        <span className="flex-1 text-[12.5px] font-semibold text-win">Paid</span>
      </div>
    );
  }
  if (extras.paymentMode !== "receipt" && extras.paymentMode !== "prepay") return null;
  const due = me.payBy ?? extras.deadline;
  const left = due ? timeLeft(due) : null;
  return (
    <Link to={eventPath(ev)} className={`${box} ${me.rejectedReason ? "bg-loss-soft" : "bg-gold-soft"}`}>
      <MoneyIcon />
      <span className="flex-1 min-w-0 text-[12.5px] text-ink-2">
        {me.hasReceipt ? (
          <>Receipt sent · waiting for an admin</>
        ) : me.rejectedReason ? (
          <>Receipt not accepted · upload a new one{left ? ` · ${left}` : ""}</>
        ) : (
          <>
            Upload your receipt{due ? <> by <b className="font-semibold text-graphite">{dayLabel(due)} {hhmm(due)}</b></> : ""}
            {left ? ` · ${left}` : ""}
          </>
        )}
      </span>
      {!me.hasReceipt && <span className="shrink-0 rounded-full bg-gold text-graphite text-[12px] font-bold px-3 py-1.5">Pay</span>}
    </Link>
  );
}

function MoneyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#836529" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function NeedIcon({ kind }: { kind: "money" | "person" | "calendar" }) {
  return (
    <span className="w-8 h-8 rounded-[10px] bg-gold-soft text-gold-ink flex items-center justify-center shrink-0" aria-hidden>
      {kind === "money" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
      ) : kind === "person" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      )}
    </span>
  );
}

