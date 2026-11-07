import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  CallupExtras,
  CallupPaymentRow,
  PaymentMode,
  PAYMENT_MODES,
  getCallupPayments,
  getCallupReceipt,
  setCallupPayment,
  uploadCallupReceipt,
} from "../../lib/supabase/eventQueries";
import AvatarLightbox from "../shell/AvatarLightbox";
import { Face, card } from "./club/ui";

/**
 * Paying for a Call-up (0080, ADR-001). Money never moves through the app:
 * players pay the way the notes say, and this records who has.
 *
 * Who sees what: a player sees their own status, members see "8 of 12 paid",
 * the owner and admins see everyone and the receipts.
 */

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayAndTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? `today ${hhmm(iso)}`
    : `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${hhmm(iso)}`;
}

/** "2h 15m" until a time, or null once it has passed. */
function timeLeft(iso: string, now: number): string | null {
  const ms = new Date(iso).getTime() - now;
  if (!(ms > 0)) return null;
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)} days`;
}

function useNow(everyMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

/* ── The admin's choice, on the Call-up form and in Club settings ───────── */

export function PaymentModePicker({ value, onChange }: { value: PaymentMode; onChange: (v: PaymentMode) => void }) {
  const hint = PAYMENT_MODES.find((m) => m.value === value)?.hint;
  return (
    <div>
      <div className="flex p-[3px] rounded-full bg-[#EFEBE4]" role="radiogroup" aria-label="Payment">
        {PAYMENT_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={value === m.value}
            onClick={() => onChange(m.value)}
            className={`flex-1 rounded-full py-2 text-[12px] font-semibold transition-colors ${
              value === m.value ? "bg-surface text-graphite shadow-[0_1px_3px_rgba(13,13,13,0.12)]" : "text-warm-gray"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {hint && <p className="text-[11.5px] text-ink-2 mt-2 px-1.5 pb-0.5 leading-snug">{hint}</p>}
    </div>
  );
}

/* ── Notes: bank details and the like, for members ──────────────────────── */

export function CallupNotes({ notes }: { notes: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(notes);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the text is on screen to select by hand */
    }
  }
  return (
    <div className={`mt-3 ${card} px-4 py-3.5`}>
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-warm-gray">Notes from the admin</p>
        <button onClick={copy} className="flex items-center gap-1.5 rounded-full bg-gold-soft text-gold-ink text-[12px] font-semibold px-3 py-1.5 active:opacity-70">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {/* Plain text with line breaks kept; never HTML. */}
      <p className="text-[14px] text-graphite mt-2 leading-relaxed whitespace-pre-wrap break-words select-text">{notes}</p>
    </div>
  );
}

/* ── The player's own payment, inside Your spot ─────────────────────────── */

export function PlayerPayment({
  eventId,
  myUserId,
  extras,
  amIn,
  onChanged,
}: {
  eventId: string;
  myUserId: string;
  extras: CallupExtras;
  /** Holding a place right now (in, not waiting). */
  amIn: boolean;
  onChanged: (next: CallupExtras | null) => void;
}) {
  const now = useNow();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const me = extras.me;
  const mode = extras.paymentMode;
  if (mode === "none") return null;

  // Moved down for not paying, and not back in yet.
  if (!amIn && me?.movedUnpaid && mode === "receipt") {
    return (
      <Inset tone="loss">
        <Chip tone="loss">Moved to the waiting list</Chip>
        <p className="text-[12.5px] text-ink-2 mt-2 leading-snug">
          No receipt arrived by the deadline, so your spot went to the next person. If a spot opens, answer I'm in again and upload your receipt within the hour.
        </p>
      </Inset>
    );
  }
  if (!amIn) return null;

  const guests = Math.max(0, (me?.spots ?? 1) - 1);
  const covers = guests > 0 ? ` Covers you and ${guests === 1 ? "your guest" : `your ${guests} guests`}.` : "";

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      onChanged(await uploadCallupReceipt(eventId, f));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't upload that.");
    } finally {
      setBusy(false);
    }
  }

  async function viewMine() {
    try {
      const url = await getCallupReceipt(eventId, myUserId);
      if (url) setPreview(url);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't open it.");
    }
  }

  if (me?.paid) {
    return (
      <Inset tone="win">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-win flex items-center justify-center shrink-0" aria-hidden>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 19 7" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-graphite">Paid</span>
            <span className="block text-[12px] text-win">
              {me.paidAt ? `Marked paid ${dayAndTime(me.paidAt)}.` : "Marked paid."}
              {covers}
            </span>
          </span>
        </div>
      </Inset>
    );
  }

  if (mode === "tick") {
    return (
      <Inset tone="plain">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Chip tone="muted">Not ticked yet</Chip>
          <span className="text-[12px] text-warm-gray">Pay as the notes say; an admin ticks you off.{covers}</span>
        </div>
      </Inset>
    );
  }

  // Receipt mode, not paid.
  const due = me?.payBy ?? extras.deadline;
  const left = due ? timeLeft(due, now) : null;
  const frozen = extras.frozenAt ? now >= new Date(extras.frozenAt).getTime() : false;
  const deadlineMs = extras.deadline ? new Date(extras.deadline).getTime() : 0;
  // How much of the window is gone, for the thin bar: a week out reads as
  // nearly empty, the last hours as nearly full.
  const span = 3 * 86400000;
  const used = due ? Math.max(0.04, Math.min(1, 1 - (new Date(due).getTime() - now) / span)) : 0;

  return (
    <Inset tone={me?.rejectedReason && !me.hasReceipt ? "loss" : "gold"}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
      {me?.hasReceipt ? (
        <>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Chip tone="gold">Receipt sent</Chip>
            <span className="text-[12px] text-ink-2">Your spot is safe while it's checked.{covers}</span>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={viewMine} className="h-[38px] px-4 rounded-full bg-surface text-ink-2 text-[12.5px] font-semibold">
              View
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex-1 h-[38px] rounded-full bg-surface text-ink-2 text-[12.5px] font-semibold disabled:opacity-40">
              {busy ? "Uploading…" : "Replace receipt"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            {me?.rejectedReason ? <Chip tone="loss">Receipt not accepted</Chip> : <Chip tone="gold-on">Not paid yet</Chip>}
            {left && !frozen && <span className={`font-mono tnum text-[13px] font-semibold ${me?.rejectedReason ? "text-loss" : "text-gold-ink"}`}>{left} left</span>}
          </div>
          {me?.rejectedReason && <p className="text-[13.5px] text-graphite mt-2">“{me.rejectedReason}”</p>}
          <p className="text-[13px] text-ink-2 mt-2 leading-snug">
            {frozen
              ? "Pay and upload your receipt so the admins can tick you off."
              : due && left
                ? me?.payBy
                  ? <>Upload by <b className="text-graphite font-semibold">{hhmm(due)}</b> to keep your spot, or it goes to the next person.</>
                  : <>Pay{guests > 0 ? " for you and your guest" + (guests > 1 ? "s" : "") : ""}, then upload the receipt by <b className="text-graphite font-semibold">{dayAndTime(due)}</b>. Without one, your spot goes to the waiting list.</>
                : "Pay and upload your receipt."}
          </p>
          {due && left && !frozen && deadlineMs > 0 && (
            <div className="h-1 rounded-full bg-gold/25 mt-3 overflow-hidden">
              <div className="h-full rounded-full bg-gold" style={{ width: `${used * 100}%` }} />
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full h-12 mt-3.5 rounded-full bg-gold text-graphite text-[14px] font-bold flex items-center justify-center gap-2 shadow-[0_6px_14px_-8px_rgba(131,101,41,0.6)] active:scale-[0.99] transition-transform disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            {busy ? "Uploading…" : me?.rejectedReason ? "Upload a new receipt" : "Upload transfer receipt"}
          </button>
        </>
      )}
      {err && <p className="text-[11.5px] text-loss mt-2">{err}</p>}
      {preview && <AvatarLightbox src={preview} alt="Your receipt" onClose={() => setPreview(null)} />}
    </Inset>
  );
}

/* ── The admins' Payments tab ──────────────────────────────────────────── */

export function AdminPayments({
  eventId,
  mode,
  version,
  deadline,
  onChanged,
}: {
  eventId: string;
  mode: PaymentMode;
  /** Bumped by the page whenever the RSVPs change, so the list follows. */
  version: number;
  deadline: string | null;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<CallupPaymentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const now = useNow();

  function load() {
    getCallupPayments(eventId)
      .then((r) => {
        setRows(r);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load payments."));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, version, mode]);

  // Thumbnails for the receipts waiting to be checked (only those).
  const toCheckIds = (rows ?? []).filter((r) => !r.paidAt && r.hasReceipt).map((r) => r.userId).join(",");
  useEffect(() => {
    let alive = true;
    for (const id of toCheckIds ? toCheckIds.split(",") : []) {
      if (thumbs[id]) continue;
      getCallupReceipt(eventId, id)
        .then((src) => alive && src && setThumbs((t) => ({ ...t, [id]: src })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toCheckIds, eventId]);

  async function act(r: CallupPaymentRow, action: "paid" | "unpaid" | "reject", why?: string) {
    setBusy(r.userId);
    setErr(null);
    try {
      await setCallupPayment(eventId, r.userId, action, why);
      setRejecting(null);
      setReason("");
      if (action !== "paid") setThumbs((t) => {
        const n = { ...t };
        delete n[r.userId];
        return n;
      });
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function view(r: CallupPaymentRow) {
    if (thumbs[r.userId]) {
      setPreview({ src: thumbs[r.userId], name: r.displayName });
      return;
    }
    setBusy(r.userId);
    try {
      const src = await getCallupReceipt(eventId, r.userId);
      if (src) setPreview({ src, name: r.displayName });
      else setErr(`${r.displayName}'s receipt is no longer there.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open it.");
    } finally {
      setBusy(null);
    }
  }

  if (mode === "none") return null;
  if (!rows) return err ? <p className="text-[12px] text-loss mt-4">{err}</p> : <p className="text-[12px] text-warm-gray mt-4 text-center">Loading payments…</p>;

  const paid = rows.filter((r) => r.paidAt);
  const toCheck = rows.filter((r) => !r.paidAt && r.hasReceipt);
  const unpaid = rows.filter((r) => !r.paidAt && !r.hasReceipt);
  const guestsLabel = (r: CallupPaymentRow) => (r.guestsIn > 0 ? ` +${r.guestsIn} guest${r.guestsIn === 1 ? "" : "s"}` : "");

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mt-4">
        <Tile n={paid.length} label="Paid" tone="win" />
        <Tile n={toCheck.length} label="To check" tone="gold" />
        <Tile n={unpaid.length} label="Not paid" tone="plain" />
      </div>
      {mode === "receipt" && deadline && (
        <p className="text-[11.5px] text-warm-gray mt-2 px-0.5">
          Deadline {dayAndTime(deadline)}. Anyone in without a receipt then moves to the waiting list.
        </p>
      )}
      {err && <p className="text-[11.5px] text-loss mt-2 px-0.5">{err}</p>}
      {rows.length === 0 && <p className="text-[12.5px] text-warm-gray mt-4 text-center">Nobody is in yet.</p>}

      {toCheck.length > 0 && (
        <>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-gold-ink mt-5 mb-2 px-0.5">To check</p>
          <div className="flex flex-col gap-2">
            {toCheck.map((r) => (
              <div key={r.userId} className={`${card} p-3`}>
                <div className="flex items-center gap-3">
                  <button onClick={() => view(r)} className="w-[54px] h-[72px] rounded-[10px] bg-surface-2 border border-line overflow-hidden shrink-0" aria-label={`View ${r.displayName}'s receipt`}>
                    {thumbs[r.userId] ? <img src={thumbs[r.userId]} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-warm-gray">Receipt</span>}
                  </button>
                  <span className="flex-1 min-w-0">
                    <b className="block text-[14.5px] font-semibold text-graphite truncate">
                      {r.displayName}
                      <span className="font-normal text-warm-gray text-[12.5px]">{guestsLabel(r)}</span>
                    </b>
                    <span className="block text-[11.5px] text-warm-gray mt-0.5">
                      {r.ownIn ? 1 + r.guestsIn : r.guestsIn} {(r.ownIn ? 1 + r.guestsIn : r.guestsIn) === 1 ? "spot" : "spots"}
                      {r.receiptAt && hhmm(r.receiptAt) ? ` · sent ${hhmm(r.receiptAt)}` : ""}
                    </span>
                    <button onClick={() => view(r)} className="text-[11.5px] font-semibold text-gold-ink mt-1.5">
                      View full size
                    </button>
                  </span>
                </div>
                {rejecting === r.userId ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(r, "reject", reason);
                    }}
                    className="flex gap-1.5 mt-3"
                  >
                    <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} placeholder="Why? e.g. wrong amount" className="flex-1 min-w-0 rounded-full border border-line bg-ivory px-3.5 py-2 text-[16px] text-ink" />
                    <button type="submit" disabled={busy === r.userId} className="shrink-0 rounded-full bg-loss-soft text-loss text-[12.5px] font-semibold px-3.5 disabled:opacity-40">
                      Reject
                    </button>
                    <button type="button" onClick={() => setRejecting(null)} className="shrink-0 text-[12px] text-warm-gray px-1">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => act(r, "paid")} disabled={busy === r.userId} className="flex-1 h-10 rounded-full bg-win text-surface text-[13px] font-semibold disabled:opacity-40">
                      Accept
                    </button>
                    <button
                      onClick={() => {
                        setRejecting(r.userId);
                        setReason("");
                      }}
                      disabled={busy === r.userId}
                      className="flex-1 h-10 rounded-full bg-loss-soft text-loss text-[13px] font-semibold disabled:opacity-40"
                    >
                      Reject…
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {unpaid.length > 0 && (
        <>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-warm-gray mt-5 mb-2 px-0.5">Not paid</p>
          <div className={`${card} overflow-hidden`}>
            {unpaid.map((r) => {
              const left = r.payBy ? timeLeft(r.payBy, now) : null;
              return (
                <div key={r.userId} className="flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0">
                  <Face name={r.displayName} url={r.avatarUrl} size={34} />
                  <span className="flex-1 min-w-0">
                    <b className="block text-[14px] font-semibold text-graphite truncate">
                      {r.displayName}
                      <span className="font-normal text-warm-gray text-[12px]">{guestsLabel(r)}</span>
                    </b>
                    <span className={`block text-[11.5px] ${left || r.rejectedReason ? "text-gold-ink font-semibold" : "text-warm-gray"}`}>
                      {r.rejectedReason ? `Rejected: ${r.rejectedReason}` : left ? `Has until ${hhmm(r.payBy!)}` : mode === "receipt" ? "No receipt yet" : "Not ticked"}
                    </span>
                  </span>
                  <button onClick={() => act(r, "paid")} disabled={busy === r.userId} className="h-8 px-3 rounded-full border border-win/40 text-win text-[12px] font-semibold disabled:opacity-40">
                    Mark paid
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {paid.length > 0 && (
        <>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-win mt-5 mb-2 px-0.5">Paid · {paid.length}</p>
          <div className={`${card} overflow-hidden`}>
            {paid.map((r) => (
              <div key={r.userId} className="flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0">
                <Face name={r.displayName} url={r.avatarUrl} size={34} />
                <span className="flex-1 min-w-0">
                  <b className="block text-[14px] font-semibold text-graphite truncate">
                    {r.displayName}
                    <span className="font-normal text-warm-gray text-[12px]">{guestsLabel(r)}</span>
                  </b>
                  {!r.ownIn && r.guestsIn === 0 && <span className="block text-[11px] text-warm-gray">Paid, no longer in</span>}
                </span>
                <span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-win-soft text-win">{r.hasReceipt ? "Paid · receipt" : "Paid"}</span>
                <button onClick={() => act(r, "unpaid")} disabled={busy === r.userId} className="text-[11.5px] font-semibold text-warm-gray px-1 disabled:opacity-40">
                  Undo
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {mode === "receipt" && (
        <p className="text-[11px] text-warm-gray mt-3 px-1 leading-snug text-center">
          Receipts are visible only to admins and the person who sent them, and are deleted 3 days after the night.
        </p>
      )}
      {preview && <AvatarLightbox src={preview.src} alt={`${preview.name}'s receipt`} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** "5 of 8 paid", for everyone who's a member. */
export function PaidCount({ extras }: { extras: CallupExtras | null }) {
  if (!extras || !extras.member || extras.paymentMode === "none" || extras.inSpots === 0) return null;
  return (
    <span className="text-[12px] text-warm-gray">
      <b className="font-mono tnum text-win">{extras.paidSpots}</b> of {extras.inSpots} paid
    </span>
  );
}

/* ── Bits ──────────────────────────────────────────────────────────────── */

function Inset({ tone, children }: { tone: "gold" | "win" | "loss" | "plain"; children: ReactNode }) {
  const bg = tone === "win" ? "bg-win-soft" : tone === "loss" ? "bg-loss-soft" : tone === "plain" ? "bg-surface-2" : "bg-gold-soft";
  return <div className={`mt-3.5 rounded-[20px] px-3.5 py-3.5 ${bg}`}>{children}</div>;
}

function Tile({ n, label, tone }: { n: number; label: string; tone: "win" | "gold" | "plain" }) {
  const cls = tone === "win" ? "bg-win-soft text-win" : tone === "gold" ? "bg-gold-soft text-gold-ink" : `${card} text-graphite`;
  return (
    <div className={`rounded-[16px] px-3 py-2.5 ${cls}`}>
      <div className="font-mono tnum text-[22px] font-semibold leading-none">{n}</div>
      <div className={`text-[11px] font-semibold mt-1 ${tone === "plain" ? "text-warm-gray" : ""}`}>{label}</div>
    </div>
  );
}

function Chip({ tone, children }: { tone: "win" | "gold" | "gold-on" | "loss" | "muted"; children: ReactNode }) {
  const cls =
    tone === "win"
      ? "bg-win-soft text-win"
      : tone === "gold"
        ? "bg-surface text-gold-ink"
        : tone === "gold-on"
          ? "bg-surface text-gold-ink"
          : tone === "loss"
            ? "bg-surface text-loss"
            : "bg-surface text-warm-gray";
  return <span className={`inline-block shrink-0 rounded-full font-bold text-[11px] px-2.5 py-1 ${cls}`}>{children}</span>;
}
