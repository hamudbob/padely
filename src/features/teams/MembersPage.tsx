import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTeam, getTeamMembers, Team, TeamMember } from "../../lib/supabase/teamQueries";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";
import { SkeletonScreen, SkeletonRows } from "../shell/Skeleton";
import { useCachedQuery } from "../../lib/cache/useCachedQuery";
import OfflineNote from "../shell/OfflineNote";

export default function MembersPage() {
  const { teamId } = useParams();
  const back = useBackNav(teamId ? `/teams/${teamId}` : "/teams");
  const { user } = useHostSession();
  const [query, setQuery] = useState("");

  // The SAME keys the club page uses, deliberately. Arriving here from a club
  // you were just looking at means both are already warm, so this screen has
  // no loading state at all in the ordinary case — and a member list that
  // changes while you walk between two screens is not a thing that happens.
  const teamQ = useCachedQuery(teamId ? `club:${teamId}` : null, () => getTeam(teamId!));
  const membersQ = useCachedQuery(teamId ? `club:${teamId}:members` : null, () => getTeamMembers(teamId!));
  const team = teamQ.data;
  const members = membersQ.data ?? [];
  const loading = teamQ.loading || membersQ.loading;

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? members.filter((m) => m.displayName.toLowerCase().includes(q)) : members), [members, q]);
  const admins = filtered.filter((m) => m.role === "owner" || m.role === "admin");
  const regular = filtered.filter((m) => m.role === "member");

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

  if (loading)
    return (
      <div className={shell}>
        {backBar}
      <OfflineNote show={teamQ.stale || membersQ.stale} at={membersQ.cachedAt} onRetry={() => { teamQ.refresh(); membersQ.refresh(); }} className="mb-2" />
        <SkeletonScreen label="Loading the members">
          <SkeletonRows n={7} avatar />
        </SkeletonScreen>
      </div>
    );

  return (
    <div className={shell}>
      {backBar}
      <div className="pt-2">
        <h1 className="font-serif text-[28px] font-semibold text-graphite tracking-tight">Members</h1>
        <p className="text-[12.5px] text-warm-gray mt-0.5">{team?.name ?? "Team"} · {members.length} {members.length === 1 ? "player" : "players"}</p>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 mt-4">
        <span className="text-warm-gray text-[15px]">⌕</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" className="flex-1 bg-transparent text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55 rounded-lg px-1" />
      </div>

      {admins.length > 0 && (
        <>
          <p className="text-[12px] font-semibold text-warm-gray mt-6 mb-2 px-0.5">Admins</p>
          <MemberList members={admins} meId={user?.id} />
        </>
      )}
      {regular.length > 0 && (
        <>
          <p className="text-[12px] font-semibold text-warm-gray mt-6 mb-2 px-0.5">Members</p>
          <MemberList members={regular} meId={user?.id} />
        </>
      )}
      {filtered.length === 0 && <p className="text-[13px] text-warm-gray text-center mt-10">No one matches “{query}”.</p>}

      <p className="text-[11px] text-warm-gray text-center mt-6 leading-snug">Tap a member to open their profile. Admins can promote or remove from there.</p>
    </div>
  );
}

function MemberList({ members, meId }: { members: TeamMember[]; meId: string | undefined }) {
  const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
  return (
    <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
      {members.map((m) => (
        <Link key={m.userId} to={`/u/${m.userId}`} className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors">
          <div className="w-[36px] h-[36px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[13px] font-semibold overflow-hidden shrink-0">
            {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" /> : m.displayName.charAt(0).toUpperCase()}
          </div>
          <span className="flex-1 min-w-0">
            <b className="block text-[14.5px] font-semibold text-graphite truncate">{m.displayName}{m.userId === meId && <span className="text-warm-gray font-normal"> · you</span>}</b>
          </span>
          {m.role !== "member" ? (
            <span className={`text-[11px] ${m.role === "owner" ? "text-gold-ink font-semibold" : "text-warm-gray"}`}>{ROLE_LABEL[m.role]}</span>
          ) : (
            <span className="text-stone text-[16px]">›</span>
          )}
        </Link>
      ))}
    </div>
  );
}
