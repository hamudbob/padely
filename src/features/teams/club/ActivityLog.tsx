import { useEffect, useState } from "react";
import { CallupLogEntry, getCallupLog } from "../../../lib/supabase/eventQueries";
import { card } from "./ui";

/**
 * The admins' Activity tab on a Call-up (0086): every step of the night, to
 * the second, with who did it. Padelier's own moves (moving the queue up,
 * the hour to pay, moving someone down for not paying) say "Padelier".
 */

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function hhmm(v: unknown): string {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
}
function dayTime(v: unknown): string {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${hhmm(v)}` : "";
}

const MODE: Record<string, string> = { none: "No payment", tick: "Tick only", receipt: "Receipt needed", prepay: "Pay to get in" };

/** One line, as a sentence. Exported for tests. */
export function describe(e: CallupLogEntry): { who: string; text: string; tone: "player" | "admin" | "auto" } {
  const who = e.automatic ? "Padelier" : e.actorName ?? "Someone";
  const s = e.subjectName ?? "someone";
  const guestOf = typeof e.detail.guest_of === "string" ? ` (${e.detail.guest_of}'s guest)` : "";
  const subj = `${s}${e.isGuest ? guestOf : ""}`;
  const self = !e.automatic && e.actorName != null && e.actorName === e.subjectName;
  const tone: "player" | "admin" | "auto" = e.automatic ? "auto" : e.action.startsWith("admin_") || ["marked_paid", "receipt_accepted", "receipt_rejected", "payment_undone", "called_off", "payment_changed", "time_changed", "cap_changed", "collecting_done", "collecting_reopened", "session_started", "posted"].includes(e.action) ? "admin" : "player";
  const map: Record<string, string> = {
    answered_in: "answered I'm in",
    answered_maybe: "answered Maybe",
    answered_out: "answered Can't make it",
    joined_waitlist: "joined the waiting list",
    moved_up: `moved ${subj} up from the waiting list`,
    moved_to_waitlist: e.detail.cause === "unpaid" ? `moved ${subj} to the waiting list: not paid in time` : `moved ${subj} to the waiting list`,
    admin_moved_in: `moved ${subj} in`,
    admin_to_waitlist: `moved ${subj} to the waiting list`,
    admin_set_maybe: `set ${subj} to Maybe`,
    admin_took_out: `took ${subj} out`,
    guest_added: `brought a guest, ${s}${e.detail.response === "waitlist" ? " (waiting list)" : ""}`,
    guest_removed: `removed their guest ${s}`,
    admin_removed_guest: `removed ${subj}`,
    guest_in: `${subj} is in`,
    guest_waiting: `${subj} is on the waiting list`,
    receipt_uploaded: e.isGuest ? `uploaded a receipt for ${s}` : "uploaded a receipt",
    receipt_replaced: e.isGuest ? `replaced the receipt for ${s}` : "replaced their receipt",
    receipt_accepted: `accepted ${subj}'s receipt`,
    marked_paid: `marked ${subj} paid${e.detail.walk_in ? " (walk-in)" : ""}`,
    payment_undone: `undid ${subj}'s payment`,
    receipt_rejected: `rejected ${subj}'s receipt${typeof e.detail.reason === "string" ? `: “${e.detail.reason}”` : ""}`,
    pay_window: `gave ${subj} until ${hhmm(e.detail.until)} to pay`,
    posted: "posted this Call-up",
    called_off: "called the night off",
    payment_changed: `changed payment from ${MODE[String(e.detail.from)] ?? e.detail.from} to ${MODE[String(e.detail.to)] ?? e.detail.to}`,
    time_changed: `moved the night to ${dayTime(e.detail.to)}`,
    cap_changed: `changed the places from ${e.detail.from ?? "no limit"} to ${e.detail.to ?? "no limit"}`,
    session_started: "started the session",
    collecting_done: "tapped Done collecting",
    collecting_reopened: "reopened collecting",
  };
  let text = map[e.action] ?? e.action.replace(/_/g, " ");
  // A player's own answer reads "Budi answered I'm in"; an upload for a guest
  // keeps the uploader as the subject of the sentence.
  if (!self && !e.automatic && e.subjectName && ["answered_in", "answered_maybe", "answered_out", "joined_waitlist"].includes(e.action)) {
    text = `${text} for ${subj}`;
  }
  return { who, text, tone };
}

export default function ActivityLog({ eventId, version }: { eventId: string; version: number }) {
  const [rows, setRows] = useState<CallupLogEntry[] | null>(null);
  const [filter, setFilter] = useState<"all" | "admin" | "auto">("all");
  useEffect(() => {
    let alive = true;
    getCallupLog(eventId).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [eventId, version]);

  if (!rows) return <p className="text-[12px] text-warm-gray mt-4 text-center">Loading the activity…</p>;
  if (rows.length === 0)
    return (
      <p className="text-[12.5px] text-warm-gray mt-6 text-center leading-snug px-4">
        Nothing recorded yet. Every answer, receipt, payment and move is listed here from now on, to the second, with who did it.
      </p>
    );

  const shown = rows.map((r) => ({ r, d: describe(r) })).filter(({ d }) => filter === "all" || d.tone === filter);
  const groups: { day: string; items: typeof shown }[] = [];
  for (const it of shown) {
    const k = day(it.r.at);
    if (!groups.length || groups[groups.length - 1].day !== k) groups.push({ day: k, items: [] });
    groups[groups.length - 1].items.push(it);
  }

  return (
    <div>
      <div className="flex gap-1.5 mt-4">
        {(
          [
            ["all", "Everything"],
            ["admin", "Admins"],
            ["auto", "Padelier"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={`h-8 px-3.5 rounded-full text-[12.5px] font-semibold ${filter === k ? "bg-graphite text-ivory" : "bg-surface text-ink-2 shadow-[0_1px_2px_rgba(13,13,13,0.05)]"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g.day}>
          <p className="text-[11px] font-semibold text-warm-gray mt-4 mb-1.5 px-1">{g.day}</p>
          <div className={`${card} overflow-hidden`}>
            {g.items.map(({ r, d }, i) => (
              <div key={i} className="flex gap-3 px-3.5 py-2.5 border-t border-line first:border-t-0">
                <span className="font-mono tnum text-[11.5px] text-warm-gray w-[58px] shrink-0 pt-[1px]">{time(r.at)}</span>
                <span
                  className={`w-[7px] h-[7px] rounded-full shrink-0 mt-[6px] ${d.tone === "admin" ? "bg-gold" : d.tone === "auto" ? "bg-[#8FB01E]" : "bg-stone"}`}
                  aria-hidden
                />
                <span className="flex-1 min-w-0 text-[13px] text-ink-2 leading-snug">
                  <b className={`font-semibold ${d.tone === "auto" ? "text-warm-gray" : "text-graphite"}`}>{d.who}</b> {d.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-warm-gray mt-3 px-1 text-center leading-snug">Only the club's owner and admins can see this.</p>
    </div>
  );
}
