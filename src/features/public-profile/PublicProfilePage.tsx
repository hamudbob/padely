import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicProfile, PublicProfile } from "../../lib/supabase/publicProfileQueries";
import { getMyTeams, setMemberRole, kickMember, MyTeam } from "../../lib/supabase/teamQueries";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";
import { RatingStrip, RecordCard, TrendCard, SectionHeading, memberSince } from "../profile/playerStats";
import AvatarLightbox from "../shell/AvatarLightbox";
import SafetySheet from "./SafetySheet";
import { unblockUser } from "../../lib/supabase/safetyQueries";
import { SkeletonScreen, SkeletonHero, SkeletonStats, SkeletonBlock } from "../shell/Skeleton";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export default function PublicProfilePage() {
  const { userId } = useParams();
  const back = useBackNav("/");
  const { user } = useHostSession();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [viewerTeams, setViewerTeams] = useState<MyTeam[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);

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
      {/* Only for a signed-in viewer looking at someone else. A logged-out
          visitor has nobody to report as, and reporting yourself is refused
          server-side anyway. */}
      {user && !isSelf && userId ? (
        <button
          onClick={() => setSafetyOpen(true)}
          aria-label="Report or block this player"
          className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95 transition-transform"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
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
        <SkeletonScreen label="Loading this player">
          <SkeletonHero className="mt-4 mb-7" />
          <SkeletonStats className="mb-6" />
          <SkeletonBlock h={150} className="mb-5" />
          <SkeletonBlock h={140} />
        </SkeletonScreen>
      </div>
    );
  if (notFound || !profile) return <div className={shell}>{bar}<p className="text-[13px] text-warm-gray mt-16 text-center">This player isn't available.</p></div>;

  const lastDelta = profile.ratingTrend.length > 0 ? profile.ratingTrend[profile.ratingTrend.length - 1].delta : 0;

  return (
    <div className={shell}>
      {bar}

      {/* Identity */}
      <div className="flex flex-col items-center text-center pt-6">
        {/* Tappable only when there's a photo — an initial has nothing to
            enlarge, and a control that does nothing is worse than no control. */}
        {profile.avatarUrl ? (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            aria-label={`See ${profile.displayName}'s photo`}
            className="w-[88px] h-[88px] rounded-full overflow-hidden bg-gold-soft active:scale-95 transition-transform"
          >
            <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
          </button>
        ) : (
          <div className="w-[88px] h-[88px] rounded-full bg-gold-soft text-gold-ink flex items-center justify-center text-[34px] font-serif font-semibold overflow-hidden">
            {profile.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        {photoOpen && profile.avatarUrl && (
          <AvatarLightbox
            src={profile.avatarUrl}
            alt={`${profile.displayName}'s photo`}
            onClose={() => setPhotoOpen(false)}
          />
        )}
        <h1 className="font-serif text-[27px] font-semibold text-graphite tracking-tight mt-3.5">{profile.displayName}</h1>
        <p className="text-[12.5px] text-warm-gray mt-1">Playing since {memberSince(profile.memberSince)}</p>
        {/* Centred to match the rest of this header. Rendered as plain text —
            React escapes it, and the 280-char cap is enforced in the database
            (0036), so it can't run away with the layout. */}
        {profile.bio && (
          <p className="text-[13.5px] leading-relaxed text-ink-2 mt-3 max-w-[300px] whitespace-pre-line">
            {profile.bio}
          </p>
        )}
      </div>

      {/* Stats — same component the You tab uses. */}
      <div className="mt-6">
        <RatingStrip rating={profile.rating} provisional={profile.provisional} games={profile.ratingGames} />
      </div>

      {/* Record — shared with the You tab, so the two can't drift apart.
          What's deliberately NOT here: best partner and toughest rival. Those
          name another player and expose their head-to-head record, which isn't
          a stranger's to read off a shared link. */}
      <SectionHeading>Record</SectionHeading>
      <RecordCard
        wins={profile.wins}
        losses={profile.losses}
        draws={profile.draws}
        form={profile.form}
        emptyLabel="No games recorded yet."
      />

      {/* Rating trend — shared card, same as the You tab. */}
      {profile.ratingTrend.length >= 2 && (
        <>
          <SectionHeading>Rating trend</SectionHeading>
          <TrendCard
            rating={profile.rating}
            points={profile.ratingTrend.map((p) => p.rating)}
            lastDelta={lastDelta}
          />
        </>
      )}

      {/* Teams */}
      <SectionHeading>Teams</SectionHeading>
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

      {/* Only ever shown to the blocker. Someone who has BEEN blocked sees a
          profile named "Player" with no explanation, which is the point. */}
      {profile.blockedByMe && (
        <div className="mt-8 rounded-2xl border border-line bg-surface-2 px-4 py-4 text-center">
          <p className="text-[13px] font-semibold text-graphite">You blocked this player</p>
          <p className="text-[12.5px] text-warm-gray leading-relaxed mt-1">
            Their name, photo and bio are hidden from you, and yours from them.
          </p>
          <button
            onClick={async () => {
              if (!userId) return;
              setBusy("unblock");
              try {
                await unblockUser(userId);
                refresh();
              } finally {
                setBusy(null);
              }
            }}
            disabled={busy === "unblock"}
            className="mt-3 rounded-full border-[1.5px] border-graphite text-graphite bg-surface text-[13px] font-semibold px-6 py-2.5 active:scale-[0.99] transition-transform disabled:opacity-40"
          >
            {busy === "unblock" ? "Unblocking…" : "Unblock"}
          </button>
        </div>
      )}

      <button onClick={share} className="w-full mt-8 rounded-full border border-line bg-surface text-ink-2 text-[12.5px] font-semibold py-2.5 active:bg-surface-2 transition-colors">
        {copied ? "Link copied ✓" : "Share this profile"}
      </button>

      {safetyOpen && userId && (
        <SafetySheet
          userId={userId}
          displayName={profile.displayName}
          onClose={() => setSafetyOpen(false)}
          onBlocked={refresh}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Tiny, dependency-free rating line. Scales to fill width; stroke stays crisp
 * via non-scaling-stroke so we never distort the line weight. */
