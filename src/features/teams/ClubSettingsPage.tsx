import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
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
  "w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[15px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55";

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

  const isAdmin = (membersQ.data ?? []).some((m) => m.userId === user?.id && (m.role === "owner" || m.role === "admin"));
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!team || !teamId) return;
    setS((prev) => prev ?? team.settings);
    getSeasonRules(teamId, team.leaguePeriod as SeasonLength)
      .then((r) => {
        setRules(r);
        // The length the NEXT season will have: a planned change, or today's.
        const current = seasonBounds(r, now);
        setLength(seasonBounds(r, current.end).length);
      })
      .catch(() => setRules([]));
  }, [team, teamId, now]);

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
      setSaved(true);
    } catch (err) {
      setError(withFallback(err, "Couldn't save the settings."));
    } finally {
      setSaving(false);
    }
  }

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";
  const backBar = (
    <div className="flex items-center justify-between mb-2">
      <button onClick={back} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (teamQ.loading || membersQ.loading || !s) {
    return (
      <div className={shell}>
        {backBar}
        <SkeletonScreen label="Loading the club settings">
          <SkeletonRows n={6} />
        </SkeletonScreen>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className={shell}>
        {backBar}
        <p className="text-[13px] text-warm-gray mt-16 text-center">Only the club's owner and admins can change its settings.</p>
      </div>
    );
  }

  const c = s.callupDefaults;
  const d = s.sessionDefaults;

  return (
    <form onSubmit={save} className={shell}>
      {backBar}
      <div className="pt-2">
        <h1 className="font-serif text-[28px] font-semibold text-graphite tracking-tight">Club settings</h1>
        <p className="text-[12.5px] text-warm-gray mt-0.5">{team?.name}</p>
      </div>

      {/* League */}
      <Section title="League">
        <Row label="Season length">
          <select value={length} onChange={(e) => { setLength(e.target.value as SeasonLength); setSaved(false); }} className={field}>
            {SEASON_LENGTHS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          {current && (
            <p className="text-[11.5px] text-warm-gray mt-1.5 leading-snug">
              This season runs {seasonDates(current.start, current.end)}.{" "}
              {change
                ? `The new length starts with the next season, on ${fmtDay(change.startsAt)}.`
                : pending
                  ? `From ${fmtDay(pending.startsAt)}, seasons are ${SEASON_LENGTHS.find((l) => l.value === pending.length)?.label.toLowerCase()} long.`
                  : "A change always starts with the next season, so nobody's standings jump mid-way."}
            </p>
          )}
        </Row>
        <Row label="Nights to appear in the table">
          <Stepper value={s.leagueMinSessions} min={1} max={20} onChange={(v) => set("leagueMinSessions", v)} />
          <p className="text-[11.5px] text-warm-gray mt-1.5 leading-snug">
            Per season. Also what it takes to be on a season's podium, so one lucky night can't win it.
          </p>
        </Row>
        <Row label="Table sorted by">
          <select value={s.defaultSort} onChange={(e) => set("defaultSort", e.target.value)} className={field}>
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Row>
      </Section>

      {/* Membership */}
      <Section title="Membership">
        <Row label="Joining with the club code">
          <Segmented
            value={s.joinMode}
            options={[{ value: "approval", label: "Needs approval" }, { value: "open", label: "Straight in" }]}
            onChange={(v) => set("joinMode", v as ClubSettings["joinMode"])}
          />
        </Row>
        <Row label="Show the club in search">
          <Segmented
            value={s.listed ? "yes" : "no"}
            options={[{ value: "yes", label: "Shown" }, { value: "no", label: "Hidden" }]}
            onChange={(v) => set("listed", v === "yes")}
          />
          <p className="text-[11.5px] text-warm-gray mt-1.5 leading-snug">Hidden clubs can still be joined with the code.</p>
        </Row>
      </Section>

      {/* Call-ups */}
      <Section title="Call-ups">
        <p className="text-[11.5px] text-warm-gray -mt-1 mb-2 leading-snug px-0.5">What a new Call-up starts with. Everything can still be changed on the Call-up itself.</p>
        <div className="grid grid-cols-2 gap-2">
          <select value={c.weekday ?? ""} onChange={(e) => setCallup("weekday", e.target.value === "" ? null : Number(e.target.value))} className={field} aria-label="Usual day">
            <option value="">Usual day</option>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>{w}</option>
            ))}
          </select>
          <input type="time" value={c.time ?? ""} onChange={(e) => setCallup("time", e.target.value || null)} className={field} aria-label="Usual time" />
        </div>
        <input value={c.title ?? ""} onChange={(e) => setCallup("title", e.target.value || null)} maxLength={80} placeholder="Title (e.g. Thursday Night)" className={`${field} mt-2`} />
        <input value={c.location ?? ""} onChange={(e) => setCallup("location", e.target.value || null)} maxLength={120} placeholder="Location" className={`${field} mt-2`} />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Mini label="Courts">
            <input value={c.courts ?? ""} onChange={(e) => setCallup("courts", e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 2)) : null)} inputMode="numeric" placeholder="—" className={field} />
          </Mini>
          <Mini label="Hours">
            <input value={c.hours ?? ""} onChange={(e) => setCallup("hours", e.target.value ? Number(e.target.value.replace(/[^\d.]/g, "").slice(0, 4)) : null)} inputMode="decimal" placeholder="—" className={field} />
          </Mini>
          <Mini label="Max players">
            <input value={c.maxPlayers ?? ""} onChange={(e) => setCallup("maxPlayers", e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 3)) : null)} inputMode="numeric" placeholder="No limit" className={field} />
          </Mini>
          <Mini label="Cost">
            <input value={c.cost ?? ""} onChange={(e) => setCallup("cost", e.target.value.slice(0, 40) || null)} placeholder="—" className={field} />
          </Mini>
        </div>
        <Row label="Payment">
          <PaymentModePicker value={c.paymentMode ?? "none"} onChange={(v) => setCallup("paymentMode", v)} />
        </Row>
        <Row label="Notes for members">
          <textarea
            value={c.notes ?? ""}
            onChange={(e) => setCallup("notes", e.target.value.slice(0, 1000) || null)}
            rows={3}
            placeholder="Bank details, QRIS, what to bring…"
            className={`${field} leading-snug`}
          />
          <p className="text-[11.5px] text-warm-gray mt-1.5 leading-snug">Shown to members on every new Call-up. Not shown on the public link.</p>
        </Row>
        <Row label="Guests each member may bring">
          <Segmented
            value={String(s.maxGuests)}
            options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: n === 0 ? "None" : String(n) }))}
            onChange={(v) => set("maxGuests", Number(v))}
          />
        </Row>
        <Row label="When a Call-up is full">
          <Segmented
            value={s.waitlistEnabled ? "list" : "full"}
            options={[{ value: "list", label: "Waiting list" }, { value: "full", label: "Say it's full" }]}
            onChange={(v) => set("waitlistEnabled", v === "list")}
          />
        </Row>
        <Row label="Reminder before a Call-up">
          <Segmented
            value={String(s.reminderMinutes)}
            options={[{ value: "60", label: "1 hour" }, { value: "120", label: "2 hours" }, { value: "0", label: "Off" }]}
            onChange={(v) => set("reminderMinutes", Number(v) as ClubSettings["reminderMinutes"])}
          />
        </Row>
      </Section>

      {/* Sessions */}
      <Section title="Club sessions">
        <p className="text-[11.5px] text-warm-gray -mt-1 mb-2 leading-snug px-0.5">What a new session for this club starts with. The host can still change it before starting.</p>
        <select value={d.format ?? ""} onChange={(e) => setSession("format", e.target.value || null)} className={field} aria-label="Format">
          <option value="">Format: host chooses</option>
          {FORMAT_OPTIONS.filter((o) => o.enabled).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Mini label="Scoring">
            <select value={d.scoringFormat ?? ""} onChange={(e) => setSession("scoringFormat", e.target.value || null)} className={field}>
              <option value="">Host chooses</option>
              {SCORING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Mini>
          <Mini label="Courts">
            <input value={d.courts ?? ""} onChange={(e) => setSession("courts", e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 2)) : null)} inputMode="numeric" placeholder="Host chooses" className={field} />
          </Mini>
        </div>
        <Row label="Counts for the league">
          <Segmented
            value={d.countsForLeague === false ? "no" : "yes"}
            options={[{ value: "yes", label: "Counts" }, { value: "no", label: "Casual" }]}
            onChange={(v) => setSession("countsForLeague", v === "yes")}
          />
        </Row>
      </Section>

      <ErrorNote error={error} where="ClubSettingsPage" className="mt-4" />
      <button
        type="submit"
        disabled={saving}
        className="w-full mt-6 rounded-full bg-graphite text-ivory text-[14px] font-semibold py-3.5 active:scale-[0.99] transition-transform disabled:opacity-50"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
      </button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2 px-0.5">{title}</h3>
      <div className="rounded-2xl bg-surface p-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[12.5px] font-semibold text-ink-2 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function Mini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-warm-gray mb-1 px-0.5">{label}</span>
      {children}
    </label>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-full bg-ivory border border-line p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold transition-colors ${value === o.value ? "bg-graphite text-ivory" : "text-warm-gray"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Fewer" className="w-9 h-9 rounded-full border border-line bg-ivory text-ink-2 text-[17px] disabled:opacity-30">−</button>
      <span className="font-mono tnum text-[17px] font-semibold text-graphite w-8 text-center">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More" className="w-9 h-9 rounded-full border border-line bg-ivory text-ink-2 text-[17px] disabled:opacity-30">+</button>
      <span className="text-[12.5px] text-warm-gray">{value === 1 ? "night" : "nights"}</span>
    </div>
  );
}
