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

/**
 * Paying for a Call-up (0080, ADR-001). Money never moves through the app:
 * players pay the way the notes say, and this records who has.
 *
 * Who sees what: a player sees their own status, members see "8 of 12 paid",
 * the owner and admins see everyone and the receipts.
 */

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayAndTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
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
  if (h < 48) return `${h}h ${m % 60}m`;
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
      <div className="flex rounded-full bg-ivory border border-line p-1" role="radiogroup" aria-label="Payment">
        {PAYMENT_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={value === m.value}
            onClick={() => onChange(m.value)}
            className={`flex-1 rounded-full py-2 text-[12px] font-semibold transition-colors ${
              value === m.value ? "bg-graphite text-ivory" : "text-warm-gray"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {hint && <p className="text-[11px] text-warm-gray mt-1.5 px-0.5 leading-snug">{hint}</p>}
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
      /* nothing to do: the text is on screen to select by hand */
    }
  }
  return (
    <div className="mt-5 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Notes</p>
        <button onClick={copy} className="text-[11.5px] font-semibold text-gold-ink active:opacity-70">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {/* Plain text with line breaks kept; never HTML. */}
      <p className="text-[13.5px] text-graphite mt-1.5 leading-relaxed whitespace-pre-wrap break-words select-text">{notes}</p>
    </div>
  );
}

/* ── The player's own payment ───────────────────────────────────────────── */

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

  const summary = extras.inSpots > 0 && (
    <p className="text-[11.5px] text-warm-gray mt-2">
      <span className="font-mono tnum font-semibold text-graphite">{extras.paidSpots}</span> of{" "}
      <span className="font-mono tnum font-semibold text-graphite">{extras.inSpots}</span> paid
    </p>
  );

  // Moved down for not paying, and not back in yet.
  if (!amIn && me?.movedUnpaid && mode === "receipt") {
    return (
      <Card>
        <Chip tone="loss">Moved to the waiting list</Chip>
        <p className="text-[12.5px] text-ink-2 mt-2 leading-snug">
          No receipt arrived by the deadline, so your spot went to the next person. If a spot is open, answer I'm in
          again and upload your receipt within the hour.
        </p>
        {summary}
      </Card>
    );
  }
  if (!amIn) {
    // Nothing of their own to show; the count is still useful.
    return summary ? <Card>{summary}</Card> : null;
  }

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
      <Card>
        <Chip tone="win">Paid ✓</Chip>
        <p className="text-[12px] text-warm-gray mt-2">
          {me.paidAt ? `Marked paid ${dayAndTime(me.paidAt)}.` : "Marked paid."}
          {covers}
        </p>
        {summary}
      </Card>
    );
  }

  if (mode === "tick") {
    return (
      <Card>
        <Chip tone="muted">Not marked paid yet</Chip>
        <p className="text-[12px] text-warm-gray mt-2 leading-snug">
          Pay the way the notes say. An admin ticks you off once it's arrived.{covers}
        </p>
        {summary}
      </Card>
    );
  }

  // Receipt mode, not paid.
  const due = me?.payBy ?? extras.deadline;
  const left = due ? timeLeft(due, now) : null;
  const frozen = extras.frozenAt ? now >= new Date(extras.frozenAt).getTime() : false;

  return (
    <Card>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
      {me?.hasReceipt ? (
        <>
          <Chip tone="gold">Receipt sent</Chip>
          <p className="text-[12px] text-warm-gray mt-2 leading-snug">
            Waiting for an admin to check it. Your spot is safe while it waits.{covers}
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={viewMine} className="rounded-full border border-line bg-surface text-ink-2 text-[12px] font-semibold py-2 px-3.5">
              View
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex-1 rounded-full border border-line bg-surface text-ink-2 text-[12px] font-semibold py-2 disabled:opacity-40"
            >
              {busy ? "Uploading…" : "Replace receipt"}
            </button>
          </div>
        </>
      ) : (
        <>
          {me?.rejectedReason ? (
            <>
              <Chip tone="loss">Receipt not accepted</Chip>
              <p className="text-[12.5px] text-ink-2 mt-2 leading-snug">{me.rejectedReason}</p>
            </>
          ) : (
            <Chip tone="muted">Not paid yet</Chip>
          )}
          <p className="text-[12px] text-warm-gray mt-2 leading-snug">
            {frozen
              ? "Pay and upload your receipt so the admins can tick you off."
              : due && left
                ? me?.payBy
                  ? `You have until ${hhmm(due)} (${left}) to pay and upload the receipt, or the spot goes to the next person.`
                  : `Pay and upload the receipt by ${dayAndTime(due)} (${left}), or your spot goes to the waiting list.`
                : "Pay and upload your receipt."}
            {covers}
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full mt-3 rounded-full bg-graphite text-ivory text-[13px] font-semibold py-2.5 active:scale-[0.99] transition-transform disabled:opacity-40"
          >
            {busy ? "Uploading…" : "Upload transfer receipt"}
          </button>
        </>
      )}
      {err && <p className="text-[11.5px] text-loss mt-2">{err}</p>}
      {summary}
      {preview && <AvatarLightbox src={preview} alt="Your receipt" onClose={() => setPreview(null)} />}
    </Card>
  );
}

/* ── The admins' list ──────────────────────────────────────────────────── */

export function AdminPayments({
  eventId,
  mode,
  version,
  onChanged,
}: {
  eventId: string;
  mode: PaymentMode;
  /** Bumped by the page whenever the RSVPs change, so the list follows. */
  version: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<CallupPaymentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
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

  async function act(r: CallupPaymentRow, action: "paid" | "unpaid" | "reject", why?: string) {
    setBusy(r.userId);
    setErr(null);
    try {
      await setCallupPayment(eventId, r.userId, action, why);
      setRejecting(null);
      setReason("");
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function view(r: CallupPaymentRow) {
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
  const list = rows ?? [];
  const toCheck = list.filter((r) => !r.paidAt && r.hasReceipt).length;
  const paid = list.filter((r) => r.paidAt).length;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-graphite" aria-hidden />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Payments</h3>
        <span className="font-mono tnum text-[11px] text-warm-gray">
          {paid}/{list.length}
        </span>
        {toCheck > 0 && (
          <span className="ml-auto text-[11px] font-semibold text-gold-ink">
            {toCheck} to check
          </span>
        )}
      </div>
      {err && <p className="text-[11.5px] text-loss mb-2 px-0.5">{err}</p>}
      {rows && list.length === 0 && (
        <p className="text-[12px] text-warm-gray px-0.5">Nobody is in yet.</p>
      )}
      {list.length > 0 && (
        <div className="rounded-2xl bg-surface border border-line overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          {list.map((r) => {
            const guests = r.guestsIn > 0 ? ` +${r.guestsIn} guest${r.guestsIn === 1 ? "" : "s"}` : "";
            const left = r.payBy ? timeLeft(r.payBy, now) : null;
            const status = r.paidAt ? (
              <Chip tone="win" small>Paid</Chip>
            ) : r.hasReceipt ? (
              <Chip tone="gold" small>Receipt to check</Chip>
            ) : r.rejectedReason ? (
              <Chip tone="loss" small>Rejected</Chip>
            ) : (
              <Chip tone="muted" small>{left ? `Until ${hhmm(r.payBy!)}` : "Not paid"}</Chip>
            );
            const rowBusy = busy === r.userId;
            return (
              <div key={r.userId} className="px-4 py-2.5 border-t border-line first:border-t-0">
                <div className="flex items-center gap-3">
                  <span className="w-[30px] h-[30px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[12px] font-semibold overflow-hidden shrink-0">
                    {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="w-full h-full object-cover" /> : r.displayName.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-semibold text-graphite truncate">
                      {r.displayName}
                      {guests && <span className="text-warm-gray font-normal text-[12px]">{guests}</span>}
                    </span>
                    {!r.ownIn && r.guestsIn === 0 && (
                      <span className="block text-[11px] text-warm-gray">Paid, no longer in</span>
                    )}
                  </span>
                  {status}
                </div>
                <div className="flex gap-1.5 mt-2 pl-[42px]">
                  {r.hasReceipt && (
                    <SmallBtn onClick={() => view(r)} disabled={rowBusy}>View receipt</SmallBtn>
                  )}
                  {!r.paidAt && (
                    <SmallBtn tone="win" onClick={() => act(r, "paid")} disabled={rowBusy}>
                      {r.hasReceipt ? "✓ Accept" : "Mark paid"}
                    </SmallBtn>
                  )}
                  {!r.paidAt && r.hasReceipt && (
                    <SmallBtn tone="loss" onClick={() => { setRejecting(r.userId); setReason(""); }} disabled={rowBusy}>
                      ✗ Reject
                    </SmallBtn>
                  )}
                  {r.paidAt && (
                    <SmallBtn onClick={() => act(r, "unpaid")} disabled={rowBusy}>Undo</SmallBtn>
                  )}
                </div>
                {rejecting === r.userId && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(r, "reject", reason);
                    }}
                    className="flex gap-1.5 mt-2 pl-[42px]"
                  >
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value.slice(0, 200))}
                      placeholder="Why? e.g. wrong amount"
                      className="flex-1 min-w-0 rounded-full border border-line bg-ivory px-3 py-1.5 text-[16px] text-ink"
                    />
                    <button type="submit" disabled={rowBusy} className="shrink-0 rounded-full bg-loss-soft text-loss text-[12px] font-semibold px-3 disabled:opacity-40">
                      Reject
                    </button>
                    <button type="button" onClick={() => setRejecting(null)} className="shrink-0 text-[12px] text-warm-gray px-1">
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
      {mode === "receipt" && (
        <p className="text-[11px] text-warm-gray mt-2 px-0.5 leading-snug">
          Receipts are only visible to you and the other admins, and are deleted 3 days after the night.
        </p>
      )}
      {preview && <AvatarLightbox src={preview.src} alt={`${preview.name}'s receipt`} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ── Bits ──────────────────────────────────────────────────────────────── */

function Card({ children }: { children: ReactNode }) {
  return <div className="mt-4 rounded-2xl border border-line bg-surface px-4 py-3.5">{children}</div>;
}

function Chip({ tone, small, children }: { tone: "win" | "gold" | "loss" | "muted"; small?: boolean; children: ReactNode }) {
  const cls =
    tone === "win"
      ? "bg-win-soft text-win"
      : tone === "gold"
        ? "bg-gold-soft text-gold-ink"
        : tone === "loss"
          ? "bg-loss-soft text-loss"
          : "bg-surface-2 text-warm-gray border border-line";
  return (
    <span className={`inline-block shrink-0 rounded-full font-bold ${small ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"} ${cls}`}>
      {children}
    </span>
  );
}

function SmallBtn({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone?: "win" | "loss";
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const cls =
    tone === "win"
      ? "border-win/40 text-win"
      : tone === "loss"
        ? "border-loss/40 text-loss"
        : "border-line text-ink-2";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border bg-surface text-[11.5px] font-semibold px-2.5 py-1 active:opacity-70 disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
