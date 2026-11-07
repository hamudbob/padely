import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getTeam, getTeamMembers, getTeamSessions, leaveTeam, uploadClubLogo, Team } from "../../lib/supabase/teamQueries";
import { getClubJoinRequests, respondJoinRequest, inviteByEmail, requestToJoin, JoinRequestItem } from "../../lib/supabase/clubJoinQueries";
import { getClubEvents, ClubEvent } from "../../lib/supabase/eventQueries";
import { getClubLeague } from "../../lib/supabase/leagueQueries";
import { useBackNav } from "../../lib/useBackNav";
import { BottomSheet } from "../shell/Sheet";
import { SkeletonScreen, SkeletonHero, SkeletonBlock, SkeletonRows } from "../shell/Skeleton";
import { useCachedQuery, invalidateQuery } from "../../lib/cache/useCachedQuery";
import OfflineNote from "../shell/OfflineNote";
import { shareUrl } from "../../lib/shareLink";
import ConfirmSheet, { ConfirmRequest } from "../shell/ConfirmSheet";
import ClubHeader, { ClubTab } from "./club/ClubHeader";
import ClubHomeTab from "./club/ClubHomeTab";
import CallupFormSheet from "./club/CallupFormSheet";
import { LeagueTab, seasonLineFor } from "./LeaguePage";
import { ChampionsTab } from "./ChampionsPage";
import { MembersTab } from "./MembersPage";

const TAB_PATH: Record<ClubTab, string> = { club: "", league: "/league", champions: "/champions", members: "/members" };

/**
 * A club (ADR-002, Nov 2026): one page, four tabs under the club's gold band.
 * Each tab has its own route (/teams/:id/league…), so a shared link or the
 * back button still lands where it should, but switching tabs replaces the
 * history entry instead of stacking four "back"s.
 */
export default function TeamDetailPage({ tab = "club" }: { tab?: ClubTab }) {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const back = useBackNav("/teams");
  const { user } = useHostSession();

  // Cached reads: the club, its members and its nights come from disk first,
  // so coming back to a club never flashes an empty page. An empty state and
  // a not-yet-loaded one look identical, which is why the flash read as
  // "my Call-ups have disappeared".
  const teamQ = useCachedQuery(teamId ? `club:${teamId}` : null, () => getTeam(teamId!));
  const membersQ = useCachedQuery(teamId ? `club:${teamId}:members` : null, () => getTeamMembers(teamId!));
  // Ended sessions only; a live one is the "Playing now" card.
  const pastQ = useCachedQuery(teamId ? `club:${teamId}:past` : null, async () => (await getTeamSessions(teamId!)).filter((x) => x.status === "ended"));
  const eventsQ = useCachedQuery(teamId ? `club:${teamId}:events` : null, () => getClubEvents(teamId!));
  const team = teamQ.data;
  const members = membersQ.data ?? [];
  const myRole = members.find((m) => m.userId === user?.id)?.role;
  const isOwner = myRole === "owner";
  const isAdmin = myRole === "owner" || myRole === "admin";
  // The season in progress, for "You're 4th in Season 3". Same cache key as
  // the League tab, so opening it is instant.
  const seasonQ = useCachedQuery(teamId && myRole ? `club:${teamId}:league:season:0` : null, () => getClubLeague(teamId!, 0));

  const past = pastQ.data ?? [];
  const events = eventsQ.data ?? [];
  const clubStale = teamQ.stale || membersQ.stale || pastQ.stale || eventsQ.stale;
  // Not-found is a real answer: getTeam resolving to null. A network error
  // must NOT say "no such club".
  const notFound = !teamQ.loading && !teamQ.error && teamQ.data === null;

  const [requests, setRequests] = useState<JoinRequestItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busyReq, setBusyReq] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestMsg, setRequestMsg] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [postWarn, setPostWarn] = useState<string | null>(null);

  // Invite sheet
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailMode, setEmailMode] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  function loadMembers() {
    if (!teamId) return;
    invalidateQuery(`club:${teamId}:members`);
    membersQ.refresh();
  }
  function loadEvents() {
    if (!teamId) return;
    invalidateQuery(`club:${teamId}:events`);
    eventsQ.refresh();
  }
  function loadRequests() {
    if (!teamId) return;
    getClubJoinRequests(teamId).then(setRequests).catch(() => setRequests([]));
  }
  useEffect(() => {
    if (isAdmin) loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, teamId]);

  function goTab(t: ClubTab) {
    if (!teamId || t === tab) return;
    navigate(`/teams/${teamId}${TAB_PATH[t]}`, { replace: true });
  }
  // A new tab starts at its top, but never jumps the band back into view if
  // you'd scrolled past it.
  useEffect(() => {
    const band = 230;
    if (window.scrollY > band) window.scrollTo({ top: band });
  }, [tab]);

  async function copyCode() {
    if (!team) return;
    try {
      await navigator.clipboard.writeText(team.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  async function shareLink() {
    if (!teamId) return;
    // shareUrl builds the link against https://padelier.id (never
    // capacitor://localhost) and only says "copied" when it did copy.
    const outcome = await shareUrl(`/teams/${teamId}`, team?.name ?? "Join my club", `Join ${team?.name ?? "our club"} on Padelier`);
    if (outcome === "copied") {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!teamId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      await inviteByEmail(teamId, inviteEmail.trim());
      setInviteMsg(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
    } catch (err) {
      setInviteMsg(err instanceof Error ? err.message : "Couldn't send the invite.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRequestJoin() {
    if (!teamId) return;
    setRequesting(true);
    setRequestMsg(null);
    try {
      await requestToJoin(teamId);
      setRequestMsg("Request sent. An admin will review it.");
    } catch (err) {
      setRequestMsg(err instanceof Error ? err.message : "Couldn't send the request.");
    } finally {
      setRequesting(false);
    }
  }

  async function decide(requestId: string, accept: boolean) {
    setBusyReq(requestId);
    setError(null);
    try {
      await respondJoinRequest(requestId, accept);
      setRequests((rs) => rs.filter((r) => r.id !== requestId));
      if (accept) loadMembers();
    } catch (err) {
      setError(withFallback(err, "That didn't work."));
    } finally {
      setBusyReq(null);
    }
  }

  async function handleLogoPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !teamId) return;
    setLogoBusy(true);
    setError(null);
    try {
      const url = await uploadClubLogo(teamId, file);
      teamQ.mutate((t) => (t ? { ...t, logoUrl: url } : t));
    } catch (err) {
      setError(withFallback(err, "Couldn't upload the logo."));
    } finally {
      setLogoBusy(false);
    }
  }

  function askLeave() {
    if (!teamId || !team) return;
    setConfirmReq({
      title: `Leave ${team.name}?`,
      body: isOwner
        ? "You're the owner. The longest-standing admin becomes the new owner, and you'd need the code to come back."
        : "Your results stay in the club's history. You'd need the code to come back.",
      confirmLabel: "Leave the club",
      tone: "danger",
      run: async () => {
        try {
          await leaveTeam(teamId);
          navigate("/teams");
        } catch (err) {
          setError(withFallback(err, "Couldn't leave the club."));
        }
      },
    });
  }

  const backBar = (
    <div className="flex items-center justify-between mb-2">
      <button onClick={back} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );
  const plainShell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";

  if (teamQ.loading || membersQ.loading)
    return (
      <div className={plainShell}>
        {backBar}
        <SkeletonScreen label="Loading this club">
          <SkeletonHero square className="mt-2 mb-6" />
          <SkeletonBlock h={216} className="mb-6" />
          <SkeletonRows n={3} />
        </SkeletonScreen>
      </div>
    );
  if (notFound || !team) return <div className={plainShell}>{backBar}<p className="text-[13px] text-warm-gray mt-16 text-center">This club isn't available.</p></div>;

  // ---- Not a member: a quiet card and a way to ask in ---------------------
  if (!myRole) {
    return (
      <div className={plainShell}>
        {backBar}
        <div className="flex flex-col items-center text-center pt-10">
          <TeamLogo team={team} size={80} />
          <h1 className="font-serif text-[27px] font-semibold text-graphite tracking-tight mt-4">{team.name}</h1>
          <p className="text-[12.5px] text-warm-gray mt-1">You're not a member of this club.</p>
        </div>
        <div className="mt-8">
          {user ? (
            <>
              <button
                onClick={handleRequestJoin}
                disabled={requesting || !!requestMsg}
                className="w-full rounded-full bg-graphite text-ivory text-[14px] font-semibold py-3 active:scale-[0.99] transition-transform disabled:opacity-50"
              >
                {requesting ? "Sending…" : requestMsg ? "Request sent" : "Request to join"}
              </button>
              {requestMsg && <p className="text-[12px] text-ink-2 mt-2.5 text-center">{requestMsg}</p>}
            </>
          ) : (
            <p className="text-[12.5px] text-warm-gray text-center">
              <Link to={`/login?next=${encodeURIComponent(`/teams/${teamId}`)}`} className="font-semibold text-gold-ink">Sign in</Link> to ask to join this club.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---- Member view --------------------------------------------------------
  const seasonLine = seasonLineFor(seasonQ.data, user?.id, team.defaultSort);
  const subline = (
    <>
      {members.length} {members.length === 1 ? "member" : "members"}
      {seasonLine ? (
        <>
          {" · "}
          <button onClick={() => goTab("league")} className="font-semibold text-gold-ink active:opacity-70">
            {seasonLine} ›
          </button>
        </>
      ) : (
        <> · {isOwner ? "You're the owner" : isAdmin ? "You're an admin" : "Member"}</>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory pb-28 anim-fade">
      <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoPick} className="hidden" />
      <ClubHeader
        team={team}
        subline={subline}
        tab={tab}
        onTab={goTab}
        isAdmin={isAdmin}
        onBack={back}
        onLogo={() => logoInputRef.current?.click()}
        logoBusy={logoBusy}
        membersDot={isAdmin && requests.length > 0}
      />

      <div className="px-5">
        <OfflineNote
          show={clubStale}
          at={teamQ.cachedAt}
          onRetry={() => {
            teamQ.refresh();
            membersQ.refresh();
            pastQ.refresh();
            eventsQ.refresh();
          }}
          className="mt-3"
        />
        <ErrorNote error={error} where="TeamDetailPage" className="mt-3" />
        {postWarn && <p className="text-[12px] text-loss mt-3 px-0.5">{postWarn}</p>}
      </div>

      {tab === "club" && (
        <ClubHomeTab
          team={team}
          members={members}
          isAdmin={isAdmin}
          events={events}
          eventsLoaded={!eventsQ.loading}
          onEventsChanged={loadEvents}
          mutateEvents={(fn) => eventsQ.mutate((prev) => fn(prev ?? []))}
          past={past}
          requests={requests}
          onDecide={decide}
          busyReq={busyReq}
          onNewCallup={() => setShowForm(true)}
          onInvite={() => setShowInvite(true)}
          userId={user?.id}
          onLeagueChanged={() => {
            invalidateQuery(`club:${teamId}:champions`);
            invalidateQuery(`club:${teamId}:league-history`);
            seasonQ.refresh();
            pastQ.refresh();
          }}
        />
      )}
      {tab === "league" && teamId && (
        <LeagueTab teamId={teamId} team={team} isAdmin={isAdmin} userId={user?.id} onTeamChanged={(t: Team) => teamQ.mutate(() => t)} />
      )}
      {tab === "champions" && teamId && <ChampionsTab teamId={teamId} userId={user?.id} />}
      {tab === "members" && (
        <MembersTab
          team={team}
          members={members}
          isAdmin={isAdmin}
          isOwner={isOwner}
          userId={user?.id}
          requests={requests}
          onDecide={decide}
          busyReq={busyReq}
          onInvite={() => setShowInvite(true)}
          onLeave={askLeave}
          onMembersChanged={loadMembers}
        />
      )}

      {showForm && teamId && (
        <CallupFormSheet
          clubId={teamId}
          defaults={team.settings?.callupDefaults}
          events={events as ClubEvent[]}
          onClose={() => setShowForm(false)}
          onSaved={(_id, warning) => {
            setShowForm(false);
            setPostWarn(warning ?? null);
            loadEvents();
          }}
        />
      )}

      {showInvite && (
        <InviteSheet
          code={team.code}
          teamName={team.name}
          isAdmin={isAdmin}
          copied={copied}
          linkCopied={linkCopied}
          onCopy={copyCode}
          onShare={shareLink}
          emailMode={emailMode}
          setEmailMode={setEmailMode}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviting={inviting}
          inviteMsg={inviteMsg}
          onInvite={handleInvite}
          onClose={() => {
            setShowInvite(false);
            setEmailMode(false);
            setInviteMsg(null);
          }}
        />
      )}
      {confirmReq && <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TeamLogo({ team, size }: { team: Team; size: number }) {
  return (
    <span
      className="rounded-[22px] bg-gold-soft text-gold-ink flex items-center justify-center font-serif font-semibold overflow-hidden"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {team.logoUrl ? <img src={team.logoUrl} alt="" className="w-full h-full object-cover" /> : team.name.charAt(0).toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
function InviteSheet(props: {
  code: string;
  teamName: string;
  isAdmin: boolean;
  copied: boolean;
  linkCopied: boolean;
  onCopy: () => void;
  onShare: () => void;
  emailMode: boolean;
  setEmailMode: (v: boolean) => void;
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  inviting: boolean;
  inviteMsg: string | null;
  onInvite: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const { code, teamName, isAdmin } = props;
  return (
    // Portalled to <body> by BottomSheet, so the tab bar can't paint over it.
    <BottomSheet onClose={props.onClose} scrim="bg-graphite/45" title={<>Invite to {teamName}</>} subtitle="Anyone with the code or link can ask to join.">
      <div className="rounded-2xl bg-surface px-4 py-3.5 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)] mb-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray">Club code</p>
        <p className="font-mono text-[26px] font-semibold tracking-[0.3em] text-graphite mt-1 pl-[0.3em]">{code}</p>
      </div>
      <button onClick={props.onCopy} className="w-full flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 mb-2.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:bg-surface-2 transition-colors">
        <span className="w-[30px] h-[30px] rounded-[9px] bg-gold-soft text-gold-ink flex items-center justify-center text-[15px]" aria-hidden>⧉</span>
        <b className="text-[14.5px] font-semibold text-graphite">{props.copied ? "Copied ✓" : "Copy club code"}</b>
      </button>
      <button onClick={props.onShare} className="w-full flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 mb-2.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:bg-surface-2 transition-colors">
        <span className="w-[30px] h-[30px] rounded-[9px] bg-gold-soft text-gold-ink flex items-center justify-center text-[15px]" aria-hidden>↗</span>
        <b className="text-[14.5px] font-semibold text-graphite">{props.linkCopied ? "Link copied ✓" : "Share link"}</b>
      </button>
      {isAdmin && !props.emailMode && (
        <button onClick={() => props.setEmailMode(true)} className="w-full flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:bg-surface-2 transition-colors">
          <span className="w-[30px] h-[30px] rounded-[9px] bg-gold-soft text-gold-ink flex items-center justify-center text-[15px]" aria-hidden>✉</span>
          <b className="text-[14.5px] font-semibold text-graphite">Invite by email</b>
        </button>
      )}
      {isAdmin && props.emailMode && (
        <form onSubmit={props.onInvite} className="rounded-2xl bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <div className="flex gap-2">
            <input value={props.inviteEmail} onChange={(e) => props.setInviteEmail(e.target.value)} type="email" placeholder="player@email.com" className="flex-1 min-w-0 rounded-xl border border-line bg-ivory px-3 py-2.5 text-[16px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55" />
            <button type="submit" disabled={props.inviting || !props.inviteEmail.trim()} className="shrink-0 rounded-xl bg-graphite text-ivory text-[13px] font-semibold px-4 disabled:opacity-40">{props.inviting ? "…" : "Send"}</button>
          </div>
          {props.inviteMsg && <p className="text-[11.5px] text-ink-2 mt-2">{props.inviteMsg}</p>}
        </form>
      )}
      <button onClick={props.onClose} className="w-full text-[14px] font-semibold text-warm-gray py-3 mt-1.5 active:opacity-70">Done</button>
    </BottomSheet>
  );
}
