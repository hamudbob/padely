import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getTeam, getTeamMembers, getTeamSessions, leaveTeam, kickMember, setMemberRole, uploadClubLogo, Team, TeamMember, TeamRole, TeamSession } from "../../lib/supabase/teamQueries";
import { getClubJoinRequests, respondJoinRequest, inviteByEmail, JoinRequestItem } from "../../lib/supabase/clubJoinQueries";
import { getClubEvents, createEvent, setRsvp, cancelEvent, ClubEvent, RsvpResponse } from "../../lib/supabase/eventQueries";

const ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export default function TeamDetailPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { user } = useHostSession();

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [requests, setRequests] = useState<JoinRequestItem[]>([]);
  const [sessions, setSessions] = useState<TeamSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [busyReq, setBusyReq] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  const myRole = members.find((m) => m.userId === user?.id)?.role;
  const isOwner = myRole === "owner";
  const isAdmin = myRole === "owner" || myRole === "admin";

  function loadMembers() {
    if (!teamId) return;
    getTeamMembers(teamId).then(setMembers).catch(() => setMembers([]));
  }
  function loadRequests() {
    if (!teamId) return;
    getClubJoinRequests(teamId).then(setRequests).catch(() => setRequests([]));
  }

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    getTeam(teamId)
      .then((t) => {
        if (!t) setNotFound(true);
        else setTeam(t);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    loadMembers();
    getTeamSessions(teamId).then(setSessions).catch(() => setSessions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // Load requests once we know we're an admin.
  useEffect(() => {
    if (isAdmin) loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, teamId]);

  async function copyCode() {
    if (!team) return;
    try {
      await navigator.clipboard.writeText(team.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code is shown anyway */
    }
  }

  async function act(fn: () => Promise<void>, userId: string) {
    setBusyUser(userId);
    setError(null);
    try {
      await fn();
      loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyUser(null);
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

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!teamId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    setInviteError(null);
    try {
      await inviteByEmail(teamId, inviteEmail.trim());
      setInviteMsg(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Couldn't send the invite.");
    } finally {
      setInviting(false);
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
    <div className="flex items-center justify-between mb-5">
      <Link to="/teams" aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</Link>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (loading) return <div className={shell}>{backBar}<p className="text-[13px] text-warm-gray mt-16 text-center">Loading…</p></div>;
  if (notFound || !team) return <div className={shell}>{backBar}<p className="text-[13px] text-warm-gray mt-16 text-center">This team isn't available.</p></div>;

  return (
    <div className={shell}>
      {backBar}

      {/* Header */}
      <div className="flex items-center gap-3.5 mb-4">
        <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoPick} className="hidden" />
        <button
          onClick={() => isAdmin && logoInputRef.current?.click()}
          disabled={!isAdmin || logoBusy}
          aria-label={isAdmin ? "Change team logo" : undefined}
          className="relative w-[52px] h-[52px] rounded-2xl bg-gold-soft text-gold-ink flex items-center justify-center font-serif font-semibold text-[22px] overflow-hidden shrink-0 disabled:cursor-default"
        >
          {team.logoUrl ? <img src={team.logoUrl} alt="" className="w-full h-full object-cover" /> : team.name.charAt(0).toUpperCase()}
          {isAdmin && (
            <span className="absolute bottom-0 right-0 w-[17px] h-[17px] rounded-full bg-gold text-graphite border-2 border-ivory flex items-center justify-center" aria-hidden>
              {logoBusy ? (
                <span className="w-2 h-2 border-2 border-graphite/40 border-t-graphite rounded-full animate-spin" />
              ) : (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="3.2" /></svg>
              )}
            </span>
          )}
        </button>
        <div className="min-w-0">
          <h1 className="font-serif text-[22px] font-semibold text-graphite tracking-tight truncate">{team.name}</h1>
          <p className="text-[12px] text-warm-gray">{members.length} {members.length === 1 ? "member" : "members"}{myRole ? ` · you're ${ROLE_LABEL[myRole].toLowerCase()}` : ""}</p>
        </div>
      </div>

      {/* Shareable code */}
      <button onClick={copyCode} className="w-full flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 mb-5 active:bg-surface-2 transition-colors">
        <span className="text-left">
          <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray">Team code</span>
          <span className="block font-mono tracking-[0.2em] text-[18px] font-semibold text-graphite">{team.code}</span>
        </span>
        <span className="text-[12px] font-semibold text-gold-ink">{copied ? "Copied ✓" : "Copy"}</span>
      </button>

      {error && <p className="text-[12px] text-loss mb-3">{error}</p>}

      {/* Pending requests (admins) */}
      {isAdmin && requests.length > 0 && (
        <div className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Requests to join</p>
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-2.5">
                <Avatar url={r.avatarUrl} name={r.displayName} />
                <b className="flex-1 min-w-0 text-[14px] font-semibold text-graphite truncate">{r.displayName}</b>
                <button onClick={() => decide(r.id, true)} disabled={busyReq === r.id} className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3 py-1.5 disabled:opacity-40">Accept</button>
                <button onClick={() => decide(r.id, false)} disabled={busyReq === r.id} className="shrink-0 text-[12px] font-semibold text-warm-gray px-1">Decline</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite (admins) */}
      {isAdmin && (
        <form onSubmit={handleInvite} className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Invite by email</p>
          <div className="flex gap-2">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email" placeholder="player@email.com" className="flex-1 min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
            <button type="submit" disabled={inviting || !inviteEmail.trim()} className="shrink-0 rounded-xl bg-graphite text-ivory text-[13px] font-semibold px-4 disabled:opacity-40">{inviting ? "…" : "Invite"}</button>
          </div>
          {inviteMsg && <p className="text-[11px] text-win mt-1.5">{inviteMsg}</p>}
          {inviteError && <p className="text-[11px] text-loss mt-1.5">{inviteError}</p>}
        </form>
      )}

      {/* League entry */}
      <Link
        to={`/teams/${teamId}/league`}
        className="flex items-center justify-between rounded-2xl border border-graphite bg-graphite text-ivory px-4 py-3.5 mb-5 active:scale-[0.99] transition-transform"
      >
        <span className="flex items-center gap-2.5">
          <span className="text-[18px]" aria-hidden>🏆</span>
          <span>
            <span className="block text-[14px] font-semibold">League table</span>
            <span className="block text-[11px] text-ivory/60">Points per session · standings this period</span>
          </span>
        </span>
        <span className="text-ivory/70 text-[18px]">›</span>
      </Link>

      {/* Scheduled sessions + RSVP */}
      {teamId && <EventsSection clubId={teamId} isAdmin={isAdmin} />}

      {/* Team sessions */}
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Team sessions</p>
        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-4 text-center">
            <p className="text-[12.5px] text-warm-gray leading-snug">
              No team sessions yet. When you create a session, pick this team on the first step to have it show up here and count toward the league.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            {sessions.map((s) => {
              // The host gets the full host/final views (they own the detail tables
              // under RLS); everyone else opens the read-only public view, which is
              // served by the get_public_session RPC and never hits host-only tables.
              const isHost = !!user?.id && s.createdBy === user.id;
              const to = isHost
                ? s.status === "live"
                  ? `/session/${s.id}/host`
                  : `/session/${s.id}/final`
                : `/live/${s.publicToken}`;
              return (
                <Link
                  key={s.id}
                  to={to}
                  className="flex items-center gap-2.5 px-3.5 py-3 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <b className="block text-[14px] font-semibold text-graphite truncate">{s.name}</b>
                    <span className="text-[11px] text-warm-gray">{formatSessionDate(s)}</span>
                  </div>
                  <StatusPill status={s.status} />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Roster */}
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Members</p>
      <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)] mb-6">
        {members.map((m) => {
          const isMe = m.userId === user?.id;
          const canRemove = isAdmin && !isMe && m.role !== "owner" && (m.role === "member" || isOwner);
          const canPromote = isAdmin && !isMe && m.role === "member";
          const canDemote = isOwner && m.role === "admin";
          return (
            <div key={m.userId} className="flex items-center gap-2.5 px-3.5 py-3 border-t border-line first:border-t-0">
              <Avatar url={m.avatarUrl} name={m.displayName} />
              <div className="flex-1 min-w-0">
                <b className="block text-[14px] font-semibold text-graphite truncate">{m.displayName}{isMe && <span className="text-warm-gray font-normal"> · you</span>}</b>
                <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${m.role === "owner" ? "text-gold-ink" : "text-warm-gray"}`}>{ROLE_LABEL[m.role]}</span>
              </div>
              {(canPromote || canDemote || canRemove) && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {canPromote && <button onClick={() => act(() => setMemberRole(teamId!, m.userId, "admin"), m.userId)} disabled={busyUser === m.userId} className="text-[11px] font-semibold text-gold-ink px-1.5 py-1">Make admin</button>}
                  {canDemote && <button onClick={() => act(() => setMemberRole(teamId!, m.userId, "member"), m.userId)} disabled={busyUser === m.userId} className="text-[11px] font-semibold text-ink-2 px-1.5 py-1">Make member</button>}
                  {canRemove && <button onClick={() => act(() => kickMember(teamId!, m.userId), m.userId)} disabled={busyUser === m.userId} className="text-[11px] font-semibold text-loss px-1.5 py-1">Remove</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={handleLeave} className="w-full text-[12.5px] font-semibold text-loss border border-line rounded-full py-2.5 bg-surface active:bg-surface-2 transition-colors">
        Leave team
      </button>
    </div>
  );
}

function EventsSection({ clubId, isAdmin }: { clubId: string; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ClubEvent[]>([]);
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
    // optimistic: reflect my choice immediately, then reconcile from the server
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, myResponse: response } : e)));
    try {
      await setRsvp(eventId, response);
    } catch {
      /* ignore — reload will correct it */
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

  function start(ev: ClubEvent) {
    navigate(`/create?club=${clubId}&name=${encodeURIComponent(ev.title)}&event=${ev.id}`);
  }

  const RSVP_OPTS: { value: RsvpResponse; label: string }[] = [
    { value: "in", label: "In" },
    { value: "maybe", label: "Maybe" },
    { value: "out", label: "Out" },
  ];

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Upcoming sessions</p>
        {isAdmin && (
          <button onClick={() => setShowForm((v) => !v)} className="text-[12px] font-semibold text-gold-ink">
            {showForm ? "Close" : "+ Schedule"}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-3.5 mb-3 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Session title (e.g. Sunday Padel)" maxLength={80} className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
          <input value={when} onChange={(e) => setWhen(e.target.value)} type="datetime-local" className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" maxLength={120} className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15" />
          {err && <p className="text-[11px] text-loss">{err}</p>}
          <button type="submit" disabled={busy || !title.trim() || !when} className="w-full rounded-full bg-graphite text-ivory text-[13px] font-semibold py-2.5 disabled:opacity-40">
            {busy ? "Scheduling…" : "Schedule session"}
          </button>
        </form>
      )}

      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-4 text-center">
          <p className="text-[12.5px] text-warm-gray leading-snug">
            No sessions scheduled.{isAdmin ? " Tap Schedule to plan one and let members RSVP." : " An admin can schedule one for the team."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {events.map((ev) => (
            <div key={ev.id} className="rounded-2xl border border-line bg-surface p-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <b className="block text-[14.5px] font-semibold text-graphite truncate">{ev.title}</b>
                  <p className="text-[11.5px] text-ink-2 mt-0.5">{formatEventWhen(ev.scheduledAt)}{ev.location ? ` · ${ev.location}` : ""}</p>
                </div>
                {isAdmin && (
                  <button onClick={() => cancel(ev.id)} className="shrink-0 text-[11px] font-semibold text-warm-gray">Cancel</button>
                )}
              </div>

              <div className="flex rounded-full bg-ivory border border-line p-1 mt-2.5">
                {RSVP_OPTS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => rsvp(ev.id, o.value)}
                    className={`flex-1 rounded-full py-1.5 text-[12px] font-semibold ${
                      ev.myResponse === o.value
                        ? o.value === "out"
                          ? "bg-warm-gray text-ivory"
                          : "bg-graphite text-ivory"
                        : "text-warm-gray"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-warm-gray mt-2">
                <b className="font-semibold text-ink-2 tnum">{ev.counts.in}</b> in
                {ev.counts.maybe > 0 ? <> · <b className="font-semibold text-ink-2 tnum">{ev.counts.maybe}</b> maybe</> : null}
                {ev.goingNames.length > 0 ? <span className="text-warm-gray"> — {ev.goingNames.slice(0, 6).join(", ")}{ev.goingNames.length > 6 ? "…" : ""}</span> : null}
              </p>

              {isAdmin && (
                <button onClick={() => start(ev)} className="w-full mt-2.5 rounded-full border border-graphite text-graphite bg-surface text-[12.5px] font-semibold py-2 active:scale-[0.99] transition-transform">
                  Start this session
                </button>
              )}
            </div>
          ))}
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

function formatSessionDate(s: TeamSession): string {
  const iso = s.endedAt ?? s.startedAt ?? s.createdAt;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function StatusPill({ status }: { status: "draft" | "live" | "ended" }) {
  if (status === "live") {
    return <span className="shrink-0 rounded-full bg-win/12 text-win text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-1">Live</span>;
  }
  return <span className="shrink-0 rounded-full bg-surface-2 text-warm-gray text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-1">Ended</span>;
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  return (
    <div className="w-[34px] h-[34px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[13px] font-semibold overflow-hidden shrink-0">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
    </div>
  );
}
