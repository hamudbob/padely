import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { BottomSheet } from "../shell/Sheet";
import ConfirmSheet, { ConfirmRequest } from "../shell/ConfirmSheet";
import { ClubVenue, deleteClubVenue, listClubVenues, safeMapsUrl, updateClubVenue } from "../../lib/supabase/eventQueries";
import { PinIcon } from "./club/CallupFormSheet";
import { useParams } from "react-router-dom";
import { getTeam, getTeamMembers, saveClubSettings, ClubSettings } from "../../lib/supabase/teamQueries";
import { getSeasonRules } from "../../lib/supabase/leagueQueries";
import { SEASON_LENGTHS, SeasonLength, SeasonRule, seasonBounds, plannedChange, pendingRule, seasonDates } from "../../lib/league/seasons";
import { FORMAT_OPTIONS, SCORING_OPTIONS } from "../create-session/CreateSessionPage";
import { PaymentModePicker } from "./CallupPayment";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";
import { useCachedQuery, invalidateQuery } from "../../lib/cache/useCachedQuery";
import { SkeletonScreen, SkeletonRows } from "../shell/Skeleton";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";

/**
 * Club settings (Phase 2, Nov 2026). The owner and admins only; one Save for
 * the whole screen (0079 update_club_settings).
 *
 * The season length is the one setting that doesn't apply at once: a change
 * starts when the season in progress ends, so nobody's standings jump mid-way.
 * The screen says exactly when.
 *
 * ADR-002 look: a gold band, grouped white cards, switches for yes/no, and a
 * save bar that only appears once something changed. Saved venues are edited
 * one at a time and save on their own, so they sit outside that bar.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SORTS = [
  { value: "pointsPerSession", label: "Points per night" },
  { value: "totalPoints", label: "Total points" },
  { value: "winsPerSession", label: "Wins per night" },
  { value: "clubScore", label: "Club Score" },
  { value: "rating", label: "Rating" },
];

const field =
  "w-full rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/40";
const pick =
  "max-w-[52%] rounded-full bg-surface-2 pl-3.5 pr-8 py-2 text-[13.5px] font-semibold text-graphite appearance-none bg-no-repeat bg-[right_0.7rem_center] bg-[length:12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/40";
const caret = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236B6A66' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
};

/** How many single settings differ: the number on the save bar. */
function countChanges(a: ClubSettings, b: ClubSettings): number {
  let n = 0;
  const cmp = (x: Record<string, unknown>, y: Record<string, unknown>) => {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const xv = x[k] ?? null;
      const yv = y[k] ?? null;
      if (xv && yv && typeof xv === "object" && typeof yv === "object") cmp(xv as Record<string, unknown>, yv as Record<string, unknown>);
      else if (JSON.stringify(xv) !== JSON.stringify(yv)) n++;
    }
  };
  cmp(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
  return n;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function ClubSettingsPage() {
  const { teamId } = useParams();
  const back = useBackNav(teamId ? `/teams/${teamId}` : "/teams");
  const { user } = useHostSession();
  const teamQ = useCachedQuery(teamId ? `club:${teamId}` : null, () => getTeam(teamId!));
  const membersQ = useCachedQuery(teamId ? `club:${teamId}:members` : null, () => getTeamMembers(teamId!));
  const team = teamQ.data;
  const [rules, setRules] = useState<SeasonRule[] | null>(null);
  const [s, setS] = useState<ClubSettings | null>(null);
  const [length, setLength] = useState<SeasonLength>("monthly");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // What's on the server, to count changes against.
  const [base, setBase] = useState<ClubSettings | null>(null);
  const [baseLength, setBaseLength] = useState<SeasonLength>("monthly");
  const [venues, setVenues] = useState<ClubVenue[] | null>(null);
  const [venue, setVenue] = useState<ClubVenue | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const isAdmin = (membersQ.data ?? []).some((m) => m.userId === user?.id && (m.role === "owner" || m.role === "admin"));
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!team || !teamId) return;
    setS((prev) => prev ?? team.settings);
    setBase((prev) => prev ?? team.settings);
    getSeasonRules(teamId, team.leaguePeriod as SeasonLength)
      .then((r) => {
        setRules(r);
        // The length the NEXT season will have: a planned change, or today's.
        const current = seasonBounds(r, now);
        const next = seasonBounds(r, current.end).length;
        setLength(next);
        setBaseLength(next);
      })
      .catch(() => setRules([]));
  }, [team, teamId, now]);

  useEffect(() => {
    if (!teamId || !isAdmin) return;
    let live = true;
    listClubVenues(teamId).then((v) => live && setVenues(v));
    return () => {
      live = false;
    };
  }, [teamId, isAdmin]);

  const current = rules && rules.length > 0 ? seasonBounds(rules, now) : null;
  const pending = rules ? pendingRule(rules, now) : null;
  const change = rules && rules.length > 0 ? plannedChange(rules, now, length) : null;

  function set<K extends keyof ClubSettings>(k: K, v: ClubSettings[K]) {
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));
    setSaved(false);
  }
  function setCallup(k: keyof ClubSettings["callupDefaults"], v: unknown) {
    setS((prev) => (prev ? { ...prev, callupDefaults: { ...prev.callupDefaults, [k]: v } } : prev));
    setSaved(false);
  }
  function setSession(k: keyof ClubSettings["sessionDefaults"], v: unknown) {
    setS((prev) => (prev ? { ...prev, sessionDefaults: { ...prev.sessionDefaults, [k]: v } } : prev));
    setSaved(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!teamId || !s) return;
    setSaving(true);
    setError(null);
    try {
      await saveClubSettings(teamId, s, change ? { length, startsAt: change.startsAt } : null);
      invalidateQuery(`club:${teamId}`);
      invalidateQuery(`club:${teamId}:league-history`);
      invalidateQuery(`club:${teamId}:league:season:0`);
      teamQ.refresh();
      const r = await getSeasonRules(teamId, length);
      setRules(r);
      setBase(s);
      setBaseLength(length);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(withFallback(err, "Couldn't save the settings."));
    } finally {
      setSaving(false);
    }
  }

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory safe-bottom anim-fade";
  const backBar = (
    <div className="bg-gold-soft rounded-b-[28px] px-5 pb-5" style={{ paddingTop: "max(1.1rem, env(safe-area-inset-top))" }}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          aria-label="Back to the club"
          className="w-9 h-9 rounded-full bg-surface/70 text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
        >
          ‹
        </button>
        <span className="text-[12px] font-semibold text-gold-ink truncate max-w-[60%]">{team?.name}</span>
        <div className="w-9" />
      </div>
      <h1 className="font-serif text-[28px] font-semibold text-graphite tracking-tight mt-3">Club settings</h1>
    </div>
  );

  if (teamQ.loading || membersQ.loading || !s) {
    return (
      <div className={shell}>
        {backBar}
        <div className="px-5 mt-5">
          <SkeletonScreen label="Loading the club settings">
            <SkeletonRows n={6} />
          </SkeletonScreen>
        </div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className={shell}>
        {backBar}
        <p className="text-[13px] text-warm-gray mt-16 px-5 text-center">Only the club's owner and admins can change its settings.</p>
      </div>
    );
  }

  const c = s.callupDefaults;
  const d = s.sessionDefaults;
  const changes = (base ? countChanges(s, base) : 0) + (length !== baseLength ? 1 : 0);

  async function saveVenue(v: ClubVenue, name: string, url: string) {
    await updateClubVenue(v.id, name, url || null);
    setVenues(await listClubVenues(teamId!));
  }
  function removeVenue(v: ClubVenue) {
    setConfirm({
      title: `Forget ${v.name}?`,
      body: "It leaves the drop-down for new Call-ups. Nights already posted keep their place and map link.",
      confirmLabel: "Forget it",
      tone: "danger",
      run: async () => {
        await deleteClubVenue(v.id);
        setVenues(await listClubVenues(teamId!));
      },
    });
  }

  return (
    <form onSubmit={save} className={shell}>
      {backBar}
      <div className="px-5 pb-28">
        {/* League */}
        <Section title="League">
          <Line label="Season length">
            <select
              value={length}
              onChange={(e) => {
                setLength(e.target.value as SeasonLength);
                setSaved(false);
              }}
              className={pick}
              style={caret}
            >
              {SEASON_LENGTHS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Line>
          {current && (
            <Hint>
              This season runs {seasonDates(current.start, current.end)}.{" "}
              {change
                ? `The new length starts with the next season, on ${fmtDay(change.startsAt)}.`
                : pending
                  ? `From ${fmtDay(pending.startsAt)}, seasons are ${SEASON_LENGTHS.find((l) => l.value === pending.length)?.label.toLowerCase()} long.`
                  : "A change always starts with the next season, so nobody's standings jump mid-way."}
            </Hint>
          )}
          <Line label="Nights to appear in the table" sub="Per season. Also what it takes to be on a season's podium.">
            <Stepper value={s.leagueMinSessions} min={1} max={20} onChange={(v) => set("leagueMinSessions", v)} />
          </Line>
          <Line label="Table sorted by">
            <select value={s.defaultSort} onChange={(e) => set("defaultSort", e.target.value)} className={pick} style={caret}>
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Line>
        </Section>

        {/* Membership */}
        <Section title="Membership">
          <Line label="New members need approval" sub={s.joinMode === "approval" ? "You accept each request to join." : "Anyone with the code is straight in."}>
            <Switch on={s.joinMode === "approval"} label="New members need approval" onChange={(v) => set("joinMode", (v ? "approval" : "open") as ClubSettings["joinMode"])} />
          </Line>
          <Line label="Show the club in search" sub="Hidden clubs can still be joined with the code.">
            <Switch on={s.listed} label="Show the club in search" onChange={(v) => set("listed", v)} />
          </Line>
        </Section>

        {/* Call-ups */}
        <Section title="New Call-ups start with" note="Everything can still be changed on the Call-up itself.">
          <Line label="Usual night">
            <span className="flex gap-1.5">
              <select
                value={c.weekday ?? ""}
                onChange={(e) => setCallup("weekday", e.target.value === "" ? null : Number(e.target.value))}
                className={`${pick} max-w-none`}
                style={caret}
                aria-label="Usual day"
              >
                <option value="">Any day</option>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i}>
                    {w.slice(0, 3)}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={c.time ?? ""}
                onChange={(e) => setCallup("time", e.target.value || null)}
                className="rounded-full bg-surface-2 px-3 py-2 text-[13.5px] font-semibold text-graphite focus:outline-none"
                aria-label="Usual time"
              />
            </span>
          </Line>
          <Stack label="Title">
            <input value={c.title ?? ""} onChange={(e) => setCallup("title", e.target.value || null)} maxLength={80} placeholder="e.g. Thursday Night" className={field} />
          </Stack>
          <Stack label="Place">
            <input
              value={c.location ?? ""}
              onChange={(e) => setCallup("location", e.target.value || null)}
              maxLength={120}
              placeholder="Where you usually play"
              list="club-venues"
              className={field}
            />
            <datalist id="club-venues">
              {(venues ?? []).map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </Stack>
          <div className="grid grid-cols-4 gap-2 px-4 py-3 border-t border-line">
            <Tile label="Courts">
              <input value={c.courts ?? ""} onChange={(e) => setCallup("courts", e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 2)) : null)} inputMode="numeric" placeholder="–" className={tileInput} />
            </Tile>
            <Tile label="Hours">
              <input value={c.hours ?? ""} onChange={(e) => setCallup("hours", e.target.value ? Number(e.target.value.replace(/[^\d.]/g, "").slice(0, 4)) : null)} inputMode="decimal" placeholder="–" className={tileInput} />
            </Tile>
            <Tile label="Players">
              <input value={c.maxPlayers ?? ""} onChange={(e) => setCallup("maxPlayers", e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 3)) : null)} inputMode="numeric" placeholder="∞" className={tileInput} />
            </Tile>
            <Tile label="Cost">
              <input value={c.cost ?? ""} onChange={(e) => setCallup("cost", e.target.value.slice(0, 40) || null)} placeholder="–" className={(c.cost ?? "").length > 5 ? tileInputSmall : tileInput} />
            </Tile>
          </div>
          <Stack label="Payment">
            <PaymentModePicker value={c.paymentMode ?? "none"} onChange={(v) => setCallup("paymentMode", v)} />
          </Stack>
          <Stack label="Notes for members" sub="Shown to members on every new Call-up. Not on the public link.">
            <textarea
              value={c.notes ?? ""}
              onChange={(e) => setCallup("notes", e.target.value.slice(0, 1000) || null)}
              rows={3}
              placeholder="Bank details, QRIS, what to bring…"
              className={`${field} leading-snug resize-none`}
            />
          </Stack>
        </Section>

        <Section title="Call-up rules">
          <Line label="Guests each member may bring">
            <span className="w-[150px]">
              <Seg
                value={String(s.maxGuests)}
                options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: n === 0 ? "0" : String(n) }))}
                onChange={(v) => set("maxGuests", Number(v))}
              />
            </span>
          </Line>
          <Line label="Waiting list when full" sub={s.waitlistEnabled ? "People queue and move up when someone drops out." : "A full night just says it's full."}>
            <Switch on={s.waitlistEnabled} label="Waiting list when full" onChange={(v) => set("waitlistEnabled", v)} />
          </Line>
          <Line label="Reminder before">
            <span className="w-[150px]">
              <Seg
                value={String(s.reminderMinutes)}
                options={[
                  { value: "60", label: "1h" },
                  { value: "120", label: "2h" },
                  { value: "0", label: "Off" },
                ]}
                onChange={(v) => set("reminderMinutes", Number(v) as ClubSettings["reminderMinutes"])}
              />
            </span>
          </Line>
        </Section>

        {/* Saved venues (0081) */}
        <Section title="Saved venues" note="Saved by themselves when you post a Call-up somewhere new. Fix a name or add its map here.">
          {venues === null ? (
            <p className="px-4 py-3.5 text-[12.5px] text-warm-gray">Loading…</p>
          ) : venues.length === 0 ? (
            <p className="px-4 py-3.5 text-[12.5px] text-warm-gray">None yet. Post a Call-up with a place and it shows up here.</p>
          ) : (
            venues.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVenue(v)}
                className="w-full flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 text-left active:bg-surface-2"
              >
                <span className="w-8 h-8 rounded-full bg-surface-2 text-ink-2 flex items-center justify-center shrink-0" aria-hidden>
                  <PinIcon size={14} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold text-graphite truncate">{v.name}</span>
                  <span className="block text-[11.5px] text-warm-gray">
                    {v.useCount > 0 ? `Used ${v.useCount} ${v.useCount === 1 ? "time" : "times"}` : "Not used yet"}
                    {v.mapsUrl ? "" : " · no map link"}
                  </span>
                </span>
                {v.mapsUrl && <span className="shrink-0 rounded-full bg-win-soft text-win text-[10px] font-bold px-2 py-0.5">MAP</span>}
                <span className="text-stone text-[16px]" aria-hidden>
                  ›
                </span>
              </button>
            ))
          )}
        </Section>

        {/* Sessions */}
        <Section title="Club sessions start with" note="The host can still change these before starting.">
          <Line label="Format">
            <select value={d.format ?? ""} onChange={(e) => setSession("format", e.target.value || null)} className={pick} style={caret} aria-label="Format">
              <option value="">Host chooses</option>
              {FORMAT_OPTIONS.filter((o) => o.enabled).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Line>
          <Line label="Scoring">
            <select value={d.scoringFormat ?? ""} onChange={(e) => setSession("scoringFormat", e.target.value || null)} className={pick} style={caret} aria-label="Scoring">
              <option value="">Host chooses</option>
              {SCORING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Line>
          <Line label="Courts">
            <input
              value={d.courts ?? ""}
              onChange={(e) => setSession("courts", e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 2)) : null)}
              inputMode="numeric"
              placeholder="Host chooses"
              aria-label="Session courts"
              className="w-[120px] rounded-full bg-surface-2 px-3.5 py-2 text-[13.5px] font-semibold text-graphite text-right placeholder:text-warm-gray placeholder:font-normal focus:outline-none"
            />
          </Line>
          <Line label="Counts for the league" sub={d.countsForLeague === false ? "Casual: results don't go in the table." : "Results go in the season table."}>
            <Switch on={d.countsForLeague !== false} label="Counts for the league" onChange={(v) => setSession("countsForLeague", v)} />
          </Line>
        </Section>

        <ErrorNote error={error} where="ClubSettingsPage" className="mt-4" />
      </div>

      {/* The save bar: only once something changed, and briefly after. */}
      {(changes > 0 || saving || saved) && (
        <div className="fixed inset-x-0 bottom-0 z-30 pointer-events-none" style={{ paddingBottom: "max(0.9rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto max-w-sm px-4 pointer-events-auto">
            <div className="flex items-center gap-3 rounded-full bg-surface/90 backdrop-blur-md shadow-[0_6px_24px_rgba(13,13,13,0.14)] pl-5 pr-1.5 py-1.5 anim-pop">
              <span className="flex-1 min-w-0 text-[12.5px] text-ink-2 truncate">
                {saved && changes === 0 ? "Saved ✓" : `${changes} ${changes === 1 ? "change" : "changes"} not saved`}
              </span>
              {changes > 0 && base && (
                <button
                  type="button"
                  onClick={() => {
                    setS(base);
                    setLength(baseLength);
                  }}
                  className="text-[12.5px] font-semibold text-warm-gray px-2 py-2"
                >
                  Undo
                </button>
              )}
              <button
                type="submit"
                disabled={saving || changes === 0}
                className="h-10 px-5 rounded-full bg-graphite text-ivory text-[13px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {venue && <VenueSheet venue={venue} onClose={() => setVenue(null)} onSave={saveVenue} onDelete={(v) => { setVenue(null); removeVenue(v); }} />}
      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </form>
  );
}

const tileInput = "w-full bg-transparent text-center font-mono tnum text-[17px] font-semibold text-graphite placeholder:text-stone focus:outline-none";
const tileInputSmall = "w-full bg-transparent text-center text-[13px] leading-[25.5px] font-semibold text-graphite focus:outline-none";

function VenueSheet({
  venue,
  onClose,
  onSave,
  onDelete,
}: {
  venue: ClubVenue;
  onClose: () => void;
  onSave: (v: ClubVenue, name: string, url: string) => Promise<void>;
  onDelete: (v: ClubVenue) => void;
}) {
  const [name, setName] = useState(venue.name);
  const [url, setUrl] = useState(venue.mapsUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const urlBad = url.trim() !== "" && !safeMapsUrl(url.trim());

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setUrl(t.trim());
    } catch {
      /* type it instead */
    }
  }
  async function submit() {
    if (!name.trim() || urlBad || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave(venue, name.trim(), url.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that place.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet onClose={onClose} title="Saved venue" subtitle="Upcoming nights at this place follow a new name and link.">
      <label className="block">
        <span className="block text-[11.5px] font-semibold text-warm-gray mb-1.5 px-1">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} />
      </label>
      <label className="block mt-3">
        <span className="block text-[11.5px] font-semibold text-warm-gray mb-1.5 px-1">Google or Apple Maps link</span>
        <span className="flex items-center gap-2 rounded-[14px] bg-surface-2 pr-1.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            placeholder="https://maps.app.goo.gl/…"
            className="flex-1 min-w-0 bg-transparent px-3.5 py-2.5 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none"
          />
          {url ? (
            <button type="button" onClick={() => setUrl("")} aria-label="Clear the link" className="shrink-0 w-8 h-8 rounded-full text-warm-gray">
              ✕
            </button>
          ) : (
            <button type="button" onClick={paste} className="shrink-0 rounded-full bg-gold-soft text-gold-ink text-[12px] font-bold px-3 py-1.5">
              Paste
            </button>
          )}
        </span>
      </label>
      {urlBad && <p className="text-[11.5px] text-loss mt-1.5 px-1">Only Google Maps or Apple Maps links work here.</p>}
      {err && <p className="text-[12px] text-loss mt-2 px-1">{err}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !name.trim() || urlBad}
        className="w-full h-12 mt-4 rounded-full bg-graphite text-ivory text-[14px] font-semibold active:scale-[0.99] transition-transform disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => onDelete(venue)} className="w-full text-[13px] font-semibold text-loss py-3 mt-1">
        Forget this place
      </button>
    </BottomSheet>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-[12px] font-semibold text-warm-gray mb-2 px-1">{title}</h3>
      <div className="rounded-[22px] bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04)] overflow-hidden">{children}</div>
      {note && <p className="text-[11.5px] text-warm-gray mt-2 px-1 leading-snug">{note}</p>}
    </section>
  );
}

/** Label left, control right. */
function Line({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 min-h-[52px]">
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-graphite leading-snug">{label}</span>
        {sub && <span className="block text-[11.5px] text-warm-gray mt-0.5 leading-snug">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

/** Label above, a full-width field below. */
function Stack({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3 border-t border-line first:border-t-0">
      <span className="block text-[12px] font-semibold text-ink-2 mb-1.5">{label}</span>
      {children}
      {sub && <span className="block text-[11.5px] text-warm-gray mt-1.5 leading-snug">{sub}</span>}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-3 -mt-1 text-[11.5px] text-warm-gray leading-snug">{children}</p>;
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block rounded-[14px] bg-surface-2 px-1 pt-2 pb-1.5 text-center">
      {children}
      <span className="block text-[10px] font-semibold text-warm-gray mt-0.5">{label}</span>
    </label>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative shrink-0 w-[46px] h-[28px] rounded-full transition-colors ${on ? "bg-win" : "bg-stone"}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] w-[22px] h-[22px] rounded-full bg-surface shadow-[0_1px_3px_rgba(13,13,13,0.2)] transition-transform ${on ? "translate-x-[18px]" : ""}`}
        aria-hidden
      />
    </button>
  );
}

function Seg({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex p-[3px] rounded-full bg-[#EFEBE4]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-full py-1.5 text-[12.5px] font-semibold transition-colors ${
            value === o.value ? "bg-surface text-graphite shadow-[0_1px_3px_rgba(13,13,13,0.1)]" : "text-warm-gray"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-surface-2 p-[3px] shrink-0">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Fewer" className="w-8 h-8 rounded-full bg-surface text-ink-2 text-[16px] disabled:opacity-30">
        −
      </button>
      <span className="font-mono tnum text-[15px] font-semibold text-graphite w-7 text-center">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More" className="w-8 h-8 rounded-full bg-surface text-ink-2 text-[16px] disabled:opacity-30">
        +
      </button>
    </div>
  );
}
