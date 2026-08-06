import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicProfile, PublicProfile, FormResult } from "../../lib/supabase/publicProfileQueries";
import { getMyTeams, setMemberRole, kickMember, MyTeam } from "../../lib/supabase/teamQueries";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** A friendly, padel-flavoured tier label derived purely from the rating. */
function tierFor(rating: number, provisional: boolean): string {
  if (provisional) return "Settling in";
  if (rating < 1350) return "Newcomer";
  if (rating < 1500) return "Developing";
  if (rating < 1650) return "Steady";
  if (rating < 1800) return "Sharp";
  if (rating < 1950) return "Strong";
  return "Elite";
}

function memberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function PublicProfilePage() {
  const { userId } = useParams();
  const back = useBackNav("/");
  const { user } = useHostSession();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewerTeams, setViewerTeams] = useState<MyTeam[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const isSelf = !!user?.id && user.id === userId;

  function refresh() {
    if (!userId) return;
    getPublicProfile(userId).then((p) => p && setProfile(p)).catch(() => {});
  }

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    getPublicProfile(userId)
      .then((p) => {
        if (!p) setNotFound(true);
        else setProfile(p);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (!user?.id || !userId || user.id === userId) {
      setViewerTeams([]);
      return;
    }
    getMyTeams().then(setViewerTeams).catch(() => setViewerTeams([]));
  }, [user?.id, userId]);

  const manage = useMemo(() => {
    if (!profile || isSelf) return [];
    return profile.teams
      .map((t) => {
        const mine = viewerTeams.find((v) => v.id === t.id);
        if (!mine || (mine.myRole !== "owner" && mine.myRole !== "admin")) return null;
        if (t.role === "owner") return null;
        const viewerIsOwner = mine.myRole === "owner";
        const canPromote = t.role === "member";
        const canDemote = viewerIsOwner && t.role === "admin";
        const canRemove = t.role === "member" || viewerIsOwner;
        if (!canPromote && !canDemote && !canRemove) return null;
        return { id: t.id, name: t.name, role: t.role, canPromote, canDemote, canRemove };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }, [profile, viewerTeams, isSelf]);

  async function runManage(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      refresh();
      if (userId) getMyTeams().then(setViewerTeams).catch(() => {});
    } catch {
      /* ignore — refresh reflects the true state */
    } finally {
      setBusy(null);
    }
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
  if (notFound || !profile) return <div className={shell}>{bar}<p className="text-[13px] text-warm-gray mt-16 text-center">This player isn't available.</p></div>;

  const tier = tierFor(profile.rating, profile.provisional);
  const total = profile.matches || 1;
  const pct = (n: number) => (n / total) * 100;
  const lastDelta = profile.ratingTrend.length > 0 ? profile.ratingTrend[profile.ratingTrend.length - 1].delta : 0;

  return (
    <div className={shell}>
      {bar}

      {/* Identity */}
      <div className="flex flex-col items-center text-center pt-6">
        <div className="w-[88px] h-[88px] rounded-full bg-gold-soft text-gold-ink flex items-center justify-center text-[34px] font-serif font-semibold overflow-hidden">
          {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" /> : profile.displayName.charAt(0).toUpperCase()}
        </div>
        <h1 className="font-serif text-[27px] font-semibold text-graphite tracking-tight mt-3.5">{profile.displayName}</h1>
        <p className="text-[12.5px] text-warm-gray mt-1">Playing since {memberSince(profile.memberSince)}</p>
      </div>

      {/* Stats */}
      <div className="mt-6 flex rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        <div className="flex-1 py-3.5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Rating</p>
          <p className="font-mono tnum text-[24px] font-semibold text-graphite leading-none mt-1.5">{profile.rating}</p>
        </div>
        <div className="w-px bg-line" />
        <div className="flex-1 py-3.5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Tier</p>
          <p className="text-[14.5px] font-semibold text-gold-ink leading-none mt-2.5">{tier}</p>
        </div>
        <div className="w-px bg-line" />
        <div className="flex-1 py-3.5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Games</p>
          <p className="font-mono tnum text-[24px] font-semibold text-graphite leading-none mt-1.5">{profile.ratingGames}</p>
        </div>
      </div>
      {profile.provisional && <p className="text-[11px] text-warm-gray text-center mt-2">Rating still settling — it sharpens as they play more.</p>}

      {/* Record */}
      <h3 className="text-[13px] font-semibold text-ink-2 mt-7 mb-2 px-0.5">Record</h3>
      <div className="rounded-2xl bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        {profile.matches === 0 ? (
          <p className="text-[12.5px] text-warm-gray text-center py-1.5">No games recorded yet.</p>
        ) : (
          <>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Win rate</p>
                <p className="font-mono tnum text-[30px] font-semibold text-graphite leading-none mt-1.5">
                  {Math.round(profile.winRate * 100)}<span className="text-[15px] text-warm-gray font-semibold">%</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">W · L · D</p>
                <p className="font-mono tnum text-[17px] font-semibold mt-1.5 leading-none">
                  <span className="text-win">{profile.wins}</span>
                  <span className="text-stone"> · </span>
                  <span className="text-loss">{profile.losses}</span>
                  <span className="text-stone"> · </span>
                  <span className="text-warm-gray">{profile.draws}</span>
                </p>
              </div>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden mt-4 bg-stone/40">
              {profile.wins > 0 && <div className="bg-win" style={{ width: `${pct(profile.wins)}%` }} />}
              {profile.losses > 0 && <div className="bg-loss" style={{ width: `${pct(profile.losses)}%` }} />}
              {profile.draws > 0 && <div className="bg-warm-gray/50" style={{ width: `${pct(profile.draws)}%` }} />}
            </div>
            <p className="text-[10.5px] text-warm-gray mt-1.5">{profile.matches} {profile.matches === 1 ? "game" : "games"} played</p>
            {profile.form.length > 0 && (
              <div className="flex items-center justify-between mt-3.5 pt-3.5 border-t border-line">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Recent form</span>
                <div className="flex gap-1.5">
                  {profile.form.map((f, i) => (
                    <FormPill key={i} r={f} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rating trend */}
      {profile.ratingTrend.length >= 2 && (
        <>
          <h3 className="text-[13px] font-semibold text-ink-2 mt-7 mb-2 px-0.5">Rating trend</h3>
          <div className="rounded-2xl bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            <div className="flex items-center justify-between mb-1.5">
              <p className="font-mono tnum text-[20px] font-semibold text-graphite leading-none">{profile.rating}</p>
              {lastDelta !== 0 && (
                <span className={`text-[12px] font-semibold ${lastDelta > 0 ? "text-win" : "text-loss"}`}>
                  {lastDelta > 0 ? "▲" : "▼"} {Math.abs(lastDelta)}
                </span>
              )}
            </div>
            <Sparkline points={profile.ratingTrend.map((p) => p.rating)} />
            <p className="text-[10.5px] text-warm-gray mt-2">Last {profile.ratingTrend.length} rated {profile.ratingTrend.length === 1 ? "session" : "sessions"}</p>
          </div>
        </>
      )}

      {/* Teams */}
      <h3 className="text-[13px] font-semibold text-ink-2 mt-7 mb-2 px-0.5">Teams</h3>
      {profile.teams.length === 0 ? (
        <div className="rounded-2xl bg-surface px-4 py-5 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <p className="text-[12.5px] text-warm-gray">Not on any team yet.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          {profile.teams.map((t) => (
            <Link key={t.id} to={`/teams/${t.id}`} className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors">
              <span className="w-[38px] h-[38px] rounded-xl bg-gold-soft text-gold-ink flex items-center justify-center font-serif font-semibold text-[16px] overflow-hidden shrink-0">
                {t.logoUrl ? <img src={t.logoUrl} alt="" className="w-full h-full object-cover" /> : t.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <b className="block text-[14.5px] font-semibold text-graphite truncate">{t.name}</b>
                <span className={`text-[11px] ${t.role === "owner" ? "text-gold-ink font-semibold" : "text-warm-gray"}`}>{ROLE_LABEL[t.role] ?? "Member"}</span>
              </span>
              <span className="text-stone text-[16px]">›</span>
            </Link>
          ))}
        </div>
      )}

      {/* Admin management for shared teams */}
      {manage.length > 0 && (
        <>
          <h3 className="text-[13px] font-semibold text-ink-2 mt-7 mb-2 px-0.5">Manage</h3>
          <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            {manage.map((m) => (
              <div key={m.id} className="px-4 py-3 border-t border-line first:border-t-0">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[13.5px] font-semibold text-graphite truncate">{m.name}</b>
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-warm-gray shrink-0">{m.role}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {m.canPromote && (
                    <button onClick={() => runManage(`p-${m.id}`, () => setMemberRole(m.id, profile.id, "admin"))} disabled={busy === `p-${m.id}`} className="text-[11.5px] font-semibold text-gold-ink rounded-full border border-line bg-surface px-3 py-1.5 disabled:opacity-40">Make admin</button>
                  )}
                  {m.canDemote && (
                    <button onClick={() => runManage(`d-${m.id}`, () => setMemberRole(m.id, profile.id, "member"))} disabled={busy === `d-${m.id}`} className="text-[11.5px] font-semibold text-ink-2 rounded-full border border-line bg-surface px-3 py-1.5 disabled:opacity-40">Make member</button>
                  )}
                  {m.canRemove && (
                    <button
                      onClick={() => {
                        if (confirm(`Remove ${profile.displayName} from ${m.name}?`)) runManage(`r-${m.id}`, () => kickMember(m.id, profile.id));
                      }}
                      disabled={busy === `r-${m.id}`}
                      className="text-[11.5px] font-semibold text-loss rounded-full border border-line bg-surface px-3 py-1.5 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <button onClick={share} className="w-full mt-8 rounded-full border border-line bg-surface text-ink-2 text-[12.5px] font-semibold py-2.5 active:bg-surface-2 transition-colors">
        {copied ? "Link copied ✓" : "Share this profile"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
function FormPill({ r }: { r: FormResult }) {
  const style =
    r === "W" ? "bg-win-soft text-win" : r === "L" ? "bg-loss-soft text-loss" : "bg-stone/40 text-ink-2";
  return (
    <span className={`w-[22px] h-[22px] rounded-md flex items-center justify-center text-[11px] font-bold ${style}`}>{r}</span>
  );
}

/** Tiny, dependency-free rating line. Scales to fill width; stroke stays crisp
 * via non-scaling-stroke so we never distort the line weight. */
function Sparkline({ points }: { points: number[] }) {
  const w = 300;
  const h = 44;
  const pad = 5;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  const stroke = up ? "#2E8B57" : "#D36A4A";
  const [lx, ly] = coords[coords.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none" aria-hidden>
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
