import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getTeam, getTeamMembers, leaveTeam, uploadClubLogo, getClubStats, Team, TeamMember, TeamRole, ClubStats } from "../../lib/supabase/teamQueries";
import { getClubJoinRequests, respondJoinRequest, inviteByEmail, requestToJoin, JoinRequestItem } from "../../lib/supabase/clubJoinQueries";
import { getClubEvents, createEvent, setRsvp, cancelEvent, ClubEvent, RsvpResponse } from "../../lib/supabase/eventQueries";
import { useBackNav } from "../../lib/useBackNav";

const ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function roleLine(role: TeamRole | undefined): string {
  if (role === "owner") return "you're the owner";
  if (role === "admin") return "you're an admin";
  if (role === "member") return "you're a member";
  return "";
}

export default function TeamDetailPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const back = useBackNav("/teams");
  const { user } = useHostSession();

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [requests, setRequests] = useState<JoinRequestItem[]>([]);
  const [stats, setStats] = useState<ClubStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyReq, setBusyReq] = useState<string | null>(null);

  const [requesting, setRequesting] = useState(false);
  const [requestMsg, setRequestMsg] = useState<string | null>(null);

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

  const myRole = members.find((m) => m.userId === user?.id)?.role;
  const isOwner = myRole === "owner";
  const isAdmin = myRole === "owner" || myRole === "admin";

  function loadMembers() {
    if (!teamId) return;
    getTeamMembers(teamId)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setMembersLoaded(true));
  }
  function loadRequests() {
    if (!teamId) return;
    getClubJoinRequests(teamId).then(setRequests).catch(() => setRequests([]));
  }

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    getTeam(teamId)
      .then((t) => (t ? setTeam(t) : setNotFound(true)))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  useEffect(() => {
    if (isAdmin) loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, teamId]);

  // Club stats strip (0027) — member-gated RPC, so it quietly no-ops for
  // non-members (whose view never renders the strip anyway).
  useEffect(() => {
    if (!teamId) return;
    getClubStats(teamId).then(setStats).catch(() => setStats(null));
  }, [teamId]);

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
    const url = `${window.location.origin}/teams/${teamId}`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: team?.name ?? "Join my team", text: `Join ${team?.name ?? "our team"} on Padelier`, url });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      /* ignore */
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
      setRequestMsg("Request sent — an admin will review it.");
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
      setError(err instanceof Error ? err.message : "That didn't work.");
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
      setTeam((t) => (t ? { ...t, logoUrl: url } : t));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload the logo.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleLeave() {
    if (!teamId) return;
    if (!confirm(isOwner ? "Leave this team? The longest-standing admin becomes the new owner." : "Leave this team?")) return;
    try {
      await leaveTeam(teamId);
      navigate("/teams");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't leave the team.");
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

  if (loading || !membersLoaded) return <div className={shell}>{backBar}<p className="text-[13px] text-warm-gray mt-16 text-center">Loading…</p></div>;
  if (notFound || !team) return <div className={shell}>{backBar}<p className="text-[13px] text-warm-gray mt-16 text-center">This team isn't available.</p></div>;

  // ---- Non-member: quiet public card + request to join --------------------
  if (!myRole) {
    return (
      <div className={shell}>
        {backBar}
        <div className="flex flex-col items-center text-center pt-10">
          <TeamLogo team={team} size={80} />
          <h1 className="font-serif text-[27px] font-semibold text-graphite tracking-tight mt-4">{team.name}</h1>
          <p className="text-[12.5px] text-warm-gray mt-1">You're not a member of this team.</p>
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
              <Link to={`/login?next=${encodeURIComponent(`/teams/${teamId}`)}`} className="font-semibold text-gold-ink">Sign in</Link> to request to join this team.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---- Member view --------------------------------------------------------
  const preview = members.slice(0, 4);

  return (
    <div className={shell}>
      {backBar}
      <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoPick} className="hidden" />

      {/* Identity */}
      <div className="flex flex-col items-center text-center pt-3">
        <button
          onClick={() => isAdmin && logoInputRef.current?.click()}
          disabled={!isAdmin || logoBusy}
          aria-label={isAdmin ? "Change team logo" : undefined}
          className="relative disabled:cursor-default"
        >
          <TeamLogo team={team} size={76} />
          {isAdmin && (
            <span className="absolute -bottom-1 -right-1 w-[20px] h-[20px] rounded-full bg-gold text-graphite border-2 border-ivory flex items-center justify-center" aria-hidden>
              {logoBusy ? (
                <span className="w-2 h-2 border-2 border-graphite/40 border-t-graphite rounded-full animate-spin" />
              ) : (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="3.2" /></svg>
              )}
            </span>
          )}
        </button>
        <h1 className="font-serif text-[27px] font-semibold text-graphite tracking-tight mt-3.5">{team.name}</h1>
        <p className="text-[12.5px] text-warm-gray mt-1">
          {members.length} {members.length === 1 ? "member" : "members"} · <span className="text-gold-ink font-semibold">{roleLine(myRole)}</span>
        </p>
      </div>

      {/* Primary action */}
      <div className="flex justify-center mt-5">
        <button onClick={() => setShowInvite(true)} className="rounded-full bg-graphite text-ivory text-[13.5px] font-semibold px-7 py-2.5 active:scale-[0.98] transition-transform">
          Invite players
        </button>
      </div>

      {error && <p className="text-[12px] text-loss mt-4 text-center">{error}</p>}

      {/* Stats strip */}
      <div className="mt-6 flex rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        <StatCell label="Members" value={members.length} />
        <div className="w-px bg-line" />
        <StatCell label="Sessions" value={stats ? stats.sessions : null} />
        <div className="w-px bg-line" />
        <StatCell label="Games" value={stats ? stats.games : null} />
      </div>

      {/* Join requests (admins) — quiet banner */}
      {isAdmin && requests.length > 0 && (
        <div className="mt-6 rounded-2xl bg-gold-soft/60 border border-gold/25 overflow-hidden">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 px-3.5 py-2.5 border-t border-gold/15 first:border-t-0">
              <Avatar url={r.avatarUrl} name={r.displayName} />
              <b className="flex-1 min-w-0 text-[13.5px] font-semibold text-graphite truncate">{r.displayName}<span className="font-normal text-warm-gray"> wants to join</span></b>
              <button onClick={() => decide(r.id, true)} disabled={busyReq === r.id} className="shrink-0 rounded-full bg-graphite text-ivory text-[11.5px] font-semibold px-3 py-1.5 disabled:opacity-40">Accept</button>
              <button onClick={() => decide(r.id, false)} disabled={busyReq === r.id} className="shrink-0 text-[11.5px] font-semibold text-warm-gray px-1">Decline</button>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming */}
      {teamId && <EventsSection clubId={teamId} isAdmin={isAdmin} />}

      {/* League + Champions */}
      <Section title="League">
        <Link to={`/teams/${teamId}/league`} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
          <span className="w-[38px] h-[38px] rounded-xl bg-gold-soft text-gold-ink flex items-center justify-center text-[18px] shrink-0" aria-hidden>🏆</span>
          <span className="flex-1 min-w-0">
            <b className="block text-[14px] font-semibold text-graphite">League table</b>
            <span className="block text-[11.5px] text-warm-gray">Points per session · this period</span>
          </span>
          <span className="text-stone text-[16px]">›</span>
        </Link>
        <Link to={`/teams/${teamId}/champions`} className="flex items-center gap-3 px-4 py-3.5 border-t border-line active:bg-surface-2 transition-colors">
          <span className="w-[38px] h-[38px] rounded-xl bg-gold-soft text-gold-ink flex items-center justify-center text-[18px] shrink-0" aria-hidden>👑</span>
          <span className="flex-1 min-w-0">
            <b className="block text-[14px] font-semibold text-graphite">Champions Hall</b>
            <span className="block text-[11.5px] text-warm-gray">Session winners &amp; all-time titles</span>
          </span>
          <span className="text-stone text-[16px]">›</span>
        </Link>
      </Section>

      {/* Members */}
      <div className="mt-7">
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h3 className="text-[13px] font-semibold text-ink-2">Members</h3>
        </div>
        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          {preview.map((m) => (
            <Link key={m.userId} to={`/u/${m.userId}`} className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors">
              <Avatar url={m.avatarUrl} name={m.displayName} />
              <span className="flex-1 min-w-0">
                <b className="block text-[14px] font-semibold text-graphite truncate">{m.displayName}{m.userId === user?.id && <span className="text-warm-gray font-normal"> · you</span>}</b>
              </span>
              <span className={`text-[11px] ${m.role === "owner" ? "text-gold-ink font-semibold" : "text-warm-gray"}`}>{ROLE_LABEL[m.role]}</span>
            </Link>
          ))}
        </div>
        {members.length > preview.length && (
          <Link to={`/teams/${teamId}/members`} className="block text-center text-[12px] font-semibold text-warm-gray mt-2.5 active:opacity-70">
            See all {members.length} ›
          </Link>
        )}
      </div>

      {/* Leave */}
      <button onClick={handleLeave} className="w-full text-[12.5px] font-semibold text-loss py-3 mt-8 active:opacity-70">
        Leave team
      </button>

      {/* Invite sheet */}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-7">
      <h3 className="text-[13px] font-semibold text-ink-2 mb-2 px-0.5">{title}</h3>
      <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">{children}</div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex-1 py-3.5 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">{label}</p>
      <p className="font-mono tnum text-[22px] font-semibold text-graphite leading-none mt-1.5">
        {value === null ? <span className="text-stone">—</span> : value}
      </p>
    </div>
  );
}

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

function Avatar({ url, name }: { url: string | null; name: string }) {
  return (
    <div className="w-[34px] h-[34px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[13px] font-semibold overflow-hidden shrink-0">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
    </div>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-graphite/45 anim-fade" onClick={props.onClose} />
      <div className="relative w-full max-w-sm bg-ivory rounded-t-[26px] px-5 pt-2.5 pb-7 anim-rise shadow-[0_-8px_40px_rgba(13,13,13,0.25)]">
        <div className="w-9 h-[5px] rounded-full bg-stone/70 mx-auto mb-3.5" />
        <h4 className="font-serif text-[20px] font-semibold text-graphite text-center">Invite to {teamName}</h4>
        <p className="text-[12px] text-warm-gray text-center mt-1 mb-4">Anyone with the code or link can ask to join.</p>

        <div className="rounded-2xl bg-surface px-4 py-3.5 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)] mb-3.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray">Team code</p>
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
              <input value={props.inviteEmail} onChange={(e) => props.setInviteEmail(e.target.value)} type="email" placeholder="player@email.com" className="flex-1 min-w-0 rounded-xl border border-line bg-ivory px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
              <button type="submit" disabled={props.inviting || !props.inviteEmail.trim()} className="shrink-0 rounded-xl bg-graphite text-ivory text-[13px] font-semibold px-4 disabled:opacity-40">{props.inviting ? "…" : "Send"}</button>
            </div>
            {props.inviteMsg && <p className="text-[11.5px] text-ink-2 mt-2">{props.inviteMsg}</p>}
          </form>
        )}

        <button onClick={props.onClose} className="w-full text-[14px] font-semibold text-warm-gray py-3 mt-1.5 active:opacity-70">Done</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function EventsSection({ clubId, isAdmin }: { clubId: string; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    getClubEvents(clubId).then(setEvents).catch(() => setEvents([]));
  }
  useEffect(load, [clubId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setBusy(true);
    setErr(null);
    try {
      await createEvent(clubId, { title, scheduledAt: new Date(when).toISOString(), location });
      setTitle("");
      setWhen("");
      setLocation("");
      setShowForm(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function rsvp(eventId: string, response: RsvpResponse) {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, myResponse: response } : e)));
    try {
      await setRsvp(eventId, response);
    } catch {
      /* reload corrects */
    }
    load();
  }

  async function cancel(eventId: string) {
    if (!confirm("Cancel this scheduled session?")) return;
    try {
      await cancelEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch {
      load();
    }
  }

  async function share(ev: ClubEvent) {
    const url = `${window.location.origin}/e/${ev.id}`;
    const text = `${ev.title} · ${formatEventWhen(ev.scheduledAt)}${ev.location ? ` @ ${ev.location}` : ""} — Padelier`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: ev.title, text, url });
        return;
      } catch {
        /* cancelled — fall through to copy */
      }
    }
    try {
      // Copy the bare URL only — pasting text+URL reads as two links on iOS.
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  }

  const RSVP_OPTS: { value: RsvpResponse; label: string }[] = [
    { value: "in", label: "In" },
    { value: "maybe", label: "Maybe" },
    { value: "out", label: "Out" },
  ];

  return (
    <div className="mt-7">
      <div className="flex items-center justify-between mb-2 px-0.5">
        <h3 className="text-[13px] font-semibold text-ink-2">Upcoming</h3>
        {isAdmin && (
          <button onClick={() => setShowForm((v) => !v)} className="text-[12.5px] font-semibold text-gold-ink active:opacity-70">
            {showForm ? "Close" : "+ Schedule"}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <form onSubmit={submit} className="rounded-2xl bg-surface p-3.5 mb-2.5 space-y-2 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Session title" maxLength={80} className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
          <input value={when} onChange={(e) => setWhen(e.target.value)} type="datetime-local" className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" maxLength={120} className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
          {err && <p className="text-[11px] text-loss">{err}</p>}
          <button type="submit" disabled={busy || !title.trim() || !when} className="w-full rounded-full bg-graphite text-ivory text-[13px] font-semibold py-2.5 disabled:opacity-40">
            {busy ? "Scheduling…" : "Schedule session"}
          </button>
        </form>
      )}

      {events.length === 0 ? (
        <div className="rounded-2xl bg-surface px-4 py-4 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <p className="text-[12.5px] text-warm-gray">No sessions scheduled{isAdmin ? " — tap + Schedule to plan one." : "."}</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          {events.map((ev) => {
            const open = openId === ev.id;
            return (
              <div key={ev.id} className="border-t border-line first:border-t-0">
                <button onClick={() => setOpenId(open ? null : ev.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-surface-2 transition-colors">
                  <span className="flex-1 min-w-0">
                    <b className="block text-[14px] font-semibold text-graphite truncate">{ev.title}</b>
                    <span className="block text-[11.5px] text-warm-gray">
                      {formatEventWhen(ev.scheduledAt)}
                      {ev.location ? ` · ${ev.location}` : ""} · {ev.counts.in} in{ev.counts.maybe > 0 ? ` · ${ev.counts.maybe} maybe` : ""}
                    </span>
                  </span>
                  <span className={`text-stone text-[15px] transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                </button>
                {open && (
                  <div className="px-4 pb-3.5">
                    <div className="flex rounded-full bg-ivory border border-line p-1 mb-2">
                      {RSVP_OPTS.map((o) => (
                        <button
                          key={o.value}
                          onClick={() => rsvp(ev.id, o.value)}
                          className={`flex-1 rounded-full py-1.5 text-[12px] font-semibold ${
                            ev.myResponse === o.value ? (o.value === "out" ? "bg-warm-gray text-ivory" : "bg-graphite text-ivory") : "text-warm-gray"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {ev.goingNames.length > 0 && <p className="text-[11px] text-warm-gray mb-2">In: {ev.goingNames.slice(0, 8).join(", ")}{ev.goingNames.length > 8 ? "…" : ""}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => share(ev)} className={`rounded-full border border-line text-ink-2 bg-surface text-[12px] font-semibold py-2 ${isAdmin ? "px-3" : "flex-1"}`}>
                        Share
                      </button>
                      {isAdmin && (
                        <>
                          <button onClick={() => navigate(`/create?club=${clubId}&name=${encodeURIComponent(ev.title)}&event=${ev.id}`)} className="flex-1 rounded-full border border-graphite text-graphite bg-surface text-[12px] font-semibold py-2 active:scale-[0.99] transition-transform">
                            Start this session
                          </button>
                          <button onClick={() => cancel(ev.id)} className="rounded-full text-[12px] font-semibold text-warm-gray px-3">Cancel</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatEventWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
