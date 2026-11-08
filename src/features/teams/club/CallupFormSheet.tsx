import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "../../shell/Sheet";
import { PaymentModePicker } from "../CallupPayment";
import type { CallupDefaults } from "../../../lib/supabase/teamQueries";
import {
  ClubEvent,
  ClubVenue,
  PaymentMode,
  createEvent,
  listClubVenues,
  safeMapsUrl,
  setCallupOptions,
  setCallupVenue,
  updateEventDetails,
  venueKey,
} from "../../../lib/supabase/eventQueries";

/** Local `YYYY-MM-DDTHH:mm`, the only format <input type="datetime-local">
 *  accepts. Shifting by the offset first stops every round trip moving the
 *  time by the timezone. */
export function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * A sensible start for a new Call-up's date and time. An empty datetime-local
 * resolves to *now* on some phones the moment it's touched, which once created
 * a night at 22:26 on a Sunday that then never showed on the club page. So:
 * the club's usual night (Club settings), else the weekday and time of its
 * latest Call-up rolled forward, else the next 19:00.
 */
export function defaultWhen(events: { scheduledAt: string }[], usual?: CallupDefaults): string {
  const now = new Date();
  if (usual && typeof usual.weekday === "number" && usual.time) {
    const [h, m] = usual.time.split(":").map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    next.setDate(next.getDate() + ((usual.weekday - now.getDay() + 7) % 7));
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
    return toLocalInput(next);
  }
  const latest = events
    .map((e) => new Date(e.scheduledAt))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const next = new Date(now);
  if (latest) {
    next.setHours(latest.getHours(), latest.getMinutes(), 0, 0);
    next.setDate(next.getDate() + ((latest.getDay() - now.getDay() + 7) % 7));
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
  } else {
    next.setHours(19, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  }
  return toLocalInput(next);
}

/** Within 6 hours of the start: the receipt deadline has already passed. */
function lateForReceipts(when: string): boolean {
  const t = new Date(when).getTime();
  return Number.isFinite(t) && t - Date.now() < 6 * 3600 * 1000;
}

/** What editing needs to know about a Call-up. */
export interface EditableCallup {
  id: string;
  title: string;
  scheduledAt: string;
  location: string | null;
  locationUrl: string | null;
  courtCount: number | null;
  durationHours: number | null;
  maxPlayers: number | null;
  cost: string | null;
  paymentMode: PaymentMode;
  notes: string | null;
  inCount: number;
}

const rowInput =
  "flex-1 min-w-0 bg-transparent text-[16px] text-ink placeholder:text-warm-gray focus:outline-none";

/**
 * Post or edit a Call-up (ADR-002). One sheet for both, so a field can never
 * exist in one and be forgotten in the other.
 */
export default function CallupFormSheet({
  clubId,
  editing,
  defaults,
  events,
  onClose,
  onSaved,
}: {
  clubId: string;
  /** Absent: a new Call-up. */
  editing?: EditableCallup | null;
  defaults?: CallupDefaults;
  events: ClubEvent[];
  onClose: () => void;
  onSaved: (eventId: string, warning?: string) => void;
}) {
  const isEdit = Boolean(editing);
  const d = defaults;
  const [title, setTitle] = useState(editing?.title ?? d?.title ?? "");
  const [when, setWhen] = useState(() => {
    if (editing) {
      const t = new Date(editing.scheduledAt);
      return Number.isNaN(t.getTime()) ? "" : toLocalInput(t);
    }
    return defaultWhen(events, d);
  });
  const [location, setLocation] = useState(editing?.location ?? d?.location ?? "");
  const [mapsUrl, setMapsUrl] = useState(editing?.locationUrl ?? "");
  const [courts, setCourts] = useState(numStr(editing ? editing.courtCount : d?.courts));
  const [hours, setHours] = useState(numStr(editing ? editing.durationHours : d?.hours));
  const [maxPlayers, setMaxPlayers] = useState(numStr(editing ? editing.maxPlayers : d?.maxPlayers));
  const [cost, setCost] = useState(editing?.cost ?? d?.cost ?? "");
  const [payMode, setPayMode] = useState<PaymentMode>(editing?.paymentMode ?? d?.paymentMode ?? "none");
  const [notes, setNotes] = useState(editing?.notes ?? d?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Saved venues, for the drop-down.
  const [venues, setVenues] = useState<ClubVenue[]>([]);
  const [venueOpen, setVenueOpen] = useState(false);
  const venueBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    listClubVenues(clubId).then((v) => live && setVenues(v));
    return () => {
      live = false;
    };
  }, [clubId]);

  const typedKey = venueKey(location);
  const known = venues.find((v) => venueKey(v.name) === typedKey) ?? null;
  const matches = useMemo(() => {
    const q = typedKey;
    const list = q ? venues.filter((v) => venueKey(v.name).includes(q)) : venues;
    return list.slice(0, 5);
  }, [venues, typedKey]);
  const isNewPlace = typedKey.length > 0 && !known;

  // A saved place brings its link along.
  useEffect(() => {
    if (known?.mapsUrl && !mapsUrl) setMapsUrl(known.mapsUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known?.id]);

  const whenIsPast = Boolean(when) && new Date(when).getTime() < Date.now();
  const mapsBad = mapsUrl.trim() !== "" && !safeMapsUrl(mapsUrl);

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setMapsUrl(t.trim());
    } catch {
      /* the field is there to type into */
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !when || busy) return;
    if (mapsBad) {
      setErr("That doesn't look like a Google Maps or Apple Maps link.");
      return;
    }
    setBusy(true);
    setErr(null);
    const warnings: string[] = [];
    try {
      let id: string;
      const nums = {
        courtCount: courts ? Number(courts) : null,
        durationHours: hours ? Number(hours) : null,
        maxPlayers: maxPlayers ? Number(maxPlayers) : null,
        cost,
      };
      if (editing) {
        id = editing.id;
        await updateEventDetails(id, { title, scheduledAt: new Date(when).toISOString(), location, ...nums });
        if (payMode !== editing.paymentMode || notes.trim() !== (editing.notes ?? "").trim()) {
          await setCallupOptions(id, payMode, notes);
        }
      } else {
        id = await createEvent(clubId, { title, scheduledAt: new Date(when).toISOString(), location, notes, ...nums });
        if (payMode !== "none") {
          try {
            await setCallupOptions(id, payMode, notes);
          } catch (e3) {
            warnings.push(`the payment option didn't save (${e3 instanceof Error ? e3.message : "error"})`);
          }
        }
      }
      // The place, saved for next time. Quietly skipped before 0081.
      const placeChanged = !editing || venueKey(editing.location ?? "") !== typedKey;
      const linkChanged = !editing || (editing.locationUrl ?? "") !== mapsUrl.trim();
      if (editing && !typedKey && editing.location) {
        try {
          await setCallupVenue(id, null, null, false);
        } catch {
          /* before 0081 a place can't be cleared; harmless */
        }
      }
      if (typedKey && (placeChanged || linkChanged)) {
        try {
          await setCallupVenue(id, location, mapsUrl || null, placeChanged);
        } catch (e4) {
          const m = e4 instanceof Error ? e4.message : "";
          if (!/function|does not exist|schema cache/i.test(m)) warnings.push(m || "the place didn't save");
        }
      }
      onSaved(id, warnings.length ? `Saved, but ${warnings.join(" and ")}.` : undefined);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't save the Call-up.");
      setBusy(false);
    }
  }

  return (
    <BottomSheet onClose={busy ? () => undefined : onClose} title={isEdit ? "Edit Call-up" : "New Call-up"}>
      <form onSubmit={submit} className="-mt-1">
        {!isEdit && d && (d.title || d.location || d.weekday != null) && (
          <p className="text-[11px] font-semibold text-gold-ink mb-2 px-0.5">Filled in from Club settings</p>
        )}

        {/* When and where */}
        <div className="rounded-[18px] bg-surface border border-line">
          <label className="flex items-center gap-3 px-3.5 h-12">
            <span className="w-[60px] text-[13px] text-warm-gray shrink-0">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Tuesday Night" className={rowInput} />
          </label>
          <label className="flex items-center gap-3 px-3.5 h-12 border-t border-line">
            <span className="w-[60px] text-[13px] text-warm-gray shrink-0">When</span>
            <input value={when} onChange={(e) => setWhen(e.target.value)} type="datetime-local" className={rowInput} />
          </label>
          <div ref={venueBox} className="relative border-t border-line">
            <label className="flex items-center gap-3 px-3.5 h-12">
              <span className="w-[60px] text-[13px] text-warm-gray shrink-0">Where</span>
              <input
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setVenueOpen(true);
                }}
                onFocus={() => setVenueOpen(true)}
                onBlur={() => window.setTimeout(() => setVenueOpen(false), 150)}
                maxLength={120}
                placeholder="Venue"
                autoComplete="off"
                role="combobox"
                aria-expanded={venueOpen && matches.length > 0}
                aria-controls="venue-options"
                className={rowInput}
              />
              {isNewPlace && <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-gold-soft text-gold-ink shrink-0">NEW</span>}
              {known?.mapsUrl && <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-win-soft text-win shrink-0">MAP</span>}
            </label>
            {venueOpen && matches.length > 0 && !(known && matches.length === 1) && (
              <div
                id="venue-options"
                role="listbox"
                className="absolute left-0 right-0 top-full mt-1.5 z-10 rounded-[18px] bg-surface overflow-hidden shadow-[0_18px_36px_-14px_rgba(13,13,13,0.35),0_1px_2px_rgba(13,13,13,0.06)]"
              >
                {matches.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="option"
                    aria-selected={known?.id === v.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setLocation(v.name);
                      setMapsUrl(v.mapsUrl ?? "");
                      setVenueOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left border-t border-line first:border-t-0 active:bg-surface-2"
                  >
                    <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${v.mapsUrl ? "bg-gold-soft text-gold-ink" : "bg-surface-2 text-warm-gray"}`} aria-hidden>
                      <PinIcon />
                    </span>
                    <span className="flex-1 min-w-0">
                      <b className="block text-[14px] font-semibold text-graphite truncate">{v.name}</b>
                      <span className="block text-[11.5px] text-warm-gray">
                        {v.mapsUrl ? "Map saved" : "No map link yet"} · used {v.useCount === 1 ? "once" : `${v.useCount} times`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {typedKey && (
            <label className="flex items-center gap-3 px-3.5 h-12 border-t border-line">
              <span className="w-[60px] text-[13px] text-warm-gray shrink-0">Map</span>
              <input
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
                inputMode="url"
                placeholder="Google Maps link (optional)"
                className={`${rowInput} text-[14px]`}
              />
              {!mapsUrl && (
                <button type="button" onClick={paste} className="shrink-0 rounded-full bg-gold-soft text-gold-ink text-[12px] font-bold px-3 py-1.5">
                  Paste
                </button>
              )}
            </label>
          )}
        </div>
        {mapsBad && <p className="text-[11.5px] text-loss mt-1.5 px-1">Only Google Maps or Apple Maps links work here.</p>}
        {isNewPlace && !mapsBad && (
          <p className="text-[11px] text-warm-gray mt-1.5 px-1 leading-snug">A new place. It's saved for the club when you post, with its map if you add one.</p>
        )}
        {whenIsPast && (
          <p className="text-[12px] text-gold-ink bg-gold-soft rounded-[14px] px-3 py-2 mt-2 leading-relaxed">
            That's in the past. A Call-up with a past date won't show on the club page, though its link still works.
          </p>
        )}

        {/* The plan */}
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-warm-gray mt-4 mb-1.5 px-0.5">The plan</p>
        <div className="grid grid-cols-4 gap-1.5">
          <PlanInput label="Courts" value={courts} onChange={(v) => setCourts(v.replace(/\D/g, "").slice(0, 2))} numeric />
          <PlanInput label="Hours" value={hours} onChange={(v) => setHours(v.replace(/[^\d.]/g, "").slice(0, 4))} decimal />
          <PlanInput label="Players" value={maxPlayers} onChange={(v) => setMaxPlayers(v.replace(/\D/g, "").slice(0, 3))} numeric placeholder="∞" />
          <PlanInput label="Cost" value={cost} onChange={(v) => setCost(v.slice(0, 40))} placeholder="—" />
        </div>
        {courts && !maxPlayers && (
          <p className="text-[11px] text-warm-gray mt-1.5 px-0.5">
            {Number(courts) * 4} players fill {courts} {Number(courts) === 1 ? "court" : "courts"}. Leave Players empty for no limit.
          </p>
        )}
        {editing && maxPlayers && Number(maxPlayers) < editing.inCount && (
          <p className="text-[11px] text-gold-ink mt-1.5 px-0.5">
            {editing.inCount} people are already in. A lower cap won't remove anyone, it just closes it to new joins.
          </p>
        )}

        {/* Payment */}
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-warm-gray mt-4 mb-1.5 px-0.5">Payment</p>
        <div className="rounded-[20px] bg-surface border border-line p-1.5">
          <PaymentModePicker value={payMode} onChange={setPayMode} />
        </div>
        {editing && payMode !== editing.paymentMode && payMode === "receipt" && lateForReceipts(when) && (
          <p className="text-[11px] text-gold-ink mt-1.5 px-0.5 leading-snug">It's past the 6-hour deadline, so everyone who's in gets 1 hour from now to upload a receipt.</p>
        )}
        {editing && payMode !== editing.paymentMode && editing.paymentMode === "receipt" && (
          <p className="text-[11px] text-warm-gray mt-1.5 px-0.5">Nobody will be moved for not paying.</p>
        )}
        {editing && payMode === "prepay" && editing.paymentMode !== "prepay" && editing.inCount > 0 && (
          <p className="text-[11px] text-gold-ink mt-1.5 px-0.5 leading-snug">
            The {editing.inCount} already in keep their spots. From now on, new answers join the list and get in by receipt.
          </p>
        )}

        {/* Notes */}
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-warm-gray mt-4 mb-1.5 px-0.5">Notes for members</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
          rows={3}
          placeholder="Bank details, QRIS, what to bring…"
          className="w-full rounded-[18px] border border-line bg-surface px-3.5 py-3 text-[16px] text-ink leading-snug placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        />
        <p className="text-[11px] text-warm-gray mt-1 px-0.5">Members only. Not shown on the public link.</p>

        {err && <p className="text-[12px] text-loss mt-3 px-0.5">{err}</p>}

        <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-1 mt-3 bg-ivory/95 backdrop-blur">
          <button type="submit" disabled={busy || !title.trim() || !when} className="w-full h-[50px] rounded-full bg-graphite text-ivory text-[14.5px] font-semibold disabled:opacity-40 active:scale-[0.99] transition-transform">
            {busy ? "Saving…" : isEdit ? "Save changes" : "Post Call-up"}
          </button>
          {!isEdit && <p className="text-[11px] text-warm-gray text-center mt-1.5">Every member gets a notification.</p>}
        </div>
      </form>
    </BottomSheet>
  );
}

function numStr(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? String(v) : "";
}

function PlanInput({
  label,
  value,
  onChange,
  numeric,
  decimal,
  placeholder = "—",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  decimal?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="rounded-[14px] bg-surface border border-line px-1 pt-2 pb-1.5 text-center">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={numeric ? "numeric" : decimal ? "decimal" : "text"}
        placeholder={placeholder}
        aria-label={label}
        className="w-full bg-transparent text-center font-mono tnum text-[17px] font-semibold text-graphite placeholder:text-stone focus:outline-none"
      />
      <span className="block text-[9.5px] font-bold tracking-[0.1em] uppercase text-warm-gray mt-0.5">{label}</span>
    </label>
  );
}

export function PinIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
