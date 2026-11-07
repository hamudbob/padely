import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { kickMember, setMemberRole, Team, TeamMember } from "../../lib/supabase/teamQueries";
import type { JoinRequestItem } from "../../lib/supabase/clubJoinQueries";
import { BottomSheet } from "../shell/Sheet";
import ConfirmSheet, { ConfirmRequest } from "../shell/ConfirmSheet";
import { Face, GearIcon, card } from "./club/ui";

/**
 * The Members tab of the club page (ADR-002): the code and Invite, people
 * asking to join, admins, members, and the way out. Was its own page until
 * Nov 2026; /teams/:id/members now opens this tab.
 */

function joined(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Joined ${d.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
function ago(iso: string | undefined): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(m >= 0)) return "";
  if (m < 60) return `Asked ${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `Asked ${h} ${h === 1 ? "hour" : "hours"} ago`;
  return `Asked ${Math.round(h / 24)} days ago`;
}

export function MembersTab({
  team,
  members,
  isAdmin,
  isOwner,
  userId,
  requests,
  onDecide,
  busyReq,
  onInvite,
  onLeave,
  onMembersChanged,
}: {
  team: Team;
  members: TeamMember[];
  isAdmin: boolean;
  isOwner: boolean;
  userId: string | undefined;
  requests: JoinRequestItem[];
  onDecide: (requestId: string, accept: boolean) => void;
  busyReq: string | null;
  onInvite: () => void;
  onLeave: () => void;
  onMembersChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [person, setPerson] = useState<TeamMember | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? members.filter((m) => m.displayName.toLowerCase().includes(q)) : members), [members, q]);
  const admins = filtered.filter((m) => m.role === "owner" || m.role === "admin");
  const regular = filtered.filter((m) => m.role === "member");

  /** What I may do to someone: the same rules the server enforces. */
  function can(m: TeamMember) {
    const self = m.userId === userId;
    return {
      promote: isAdmin && !self && m.role === "member",
      demote: isOwner && !self && m.role === "admin",
      remove: !self && m.role !== "owner" && (m.role === "member" ? isAdmin : isOwner),
    };
  }

  async function run(fn: () => Promise<void>, done: string) {
    setNote(null);
    try {
      await fn();
      setNote(done);
      onMembersChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work.");
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(team.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  const row = (m: TeamMember) => {
    const c = can(m);
    const any = c.promote || c.demote || c.remove;
    return (
      <div key={m.userId} className="flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0">
        <Link to={`/u/${m.userId}`} className="flex items-center gap-3 flex-1 min-w-0 active:opacity-70">
          <Face name={m.displayName} url={m.avatarUrl} size={40} ring={m.role === "owner"} />
          <span className="flex-1 min-w-0">
            <b className="block text-[14.5px] font-semibold text-graphite truncate">
              {m.displayName}
              {m.userId === userId && <span className="font-normal text-warm-gray"> · you</span>}
            </b>
            <span className="block text-[11.5px] text-warm-gray">{joined(m.joinedAt)}</span>
          </span>
        </Link>
        {m.role !== "member" && (
          <span className={`text-[11px] font-semibold shrink-0 ${m.role === "owner" ? "text-gold-ink" : "text-warm-gray"}`}>{m.role === "owner" ? "Owner" : "Admin"}</span>
        )}
        {any && (
          <button
            onClick={() => setPerson(m)}
            aria-label={`Options for ${m.displayName}`}
            className="w-[30px] h-[30px] rounded-full text-warm-gray flex items-center justify-center shrink-0 active:bg-surface-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="px-5">
      {/* Invite lives here */}
      <div className={`mt-5 ${card} px-4 py-3.5 flex items-center gap-3`}>
        <button onClick={copyCode} className="flex-1 min-w-0 text-left active:opacity-70" aria-label="Copy the club code">
          <span className="block text-[11px] font-semibold text-warm-gray">{copied ? "Copied ✓" : "Club code · tap to copy"}</span>
          <span className="block font-mono text-[21px] font-semibold tracking-[0.12em] text-graphite mt-0.5">{team.code}</span>
        </button>
        <button onClick={onInvite} className="h-10 px-[18px] rounded-full bg-graphite text-ivory text-[13px] font-semibold shrink-0 active:scale-[0.98] transition-transform">
          Invite players
        </button>
      </div>

      {members.length > 6 && (
        <label className="flex items-center gap-2.5 h-11 mt-3 px-4 rounded-full bg-[#EFEBE4]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B6A66" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${members.length} members`} className="flex-1 min-w-0 bg-transparent text-[16px] text-ink placeholder:text-warm-gray focus:outline-none" />
        </label>
      )}

      {note && <p className="text-[12px] text-ink-2 mt-3 px-1">{note}</p>}

      {isAdmin && requests.length > 0 && (
        <>
          <p className="text-[12px] font-semibold text-loss mt-5 px-0.5">Wants to join · {requests.length}</p>
          <div className={`mt-2 ${card} overflow-hidden`}>
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0">
                <Face name={r.displayName} url={r.avatarUrl} size={38} />
                <span className="flex-1 min-w-0">
                  <b className="block text-[14.5px] font-semibold text-graphite truncate">{r.displayName}</b>
                  <span className="block text-[11.5px] text-warm-gray">{ago((r as { createdAt?: string }).createdAt)}</span>
                </span>
                <button onClick={() => onDecide(r.id, true)} disabled={busyReq === r.id} className="h-[34px] px-3.5 rounded-full bg-win-soft text-win text-[12.5px] font-bold disabled:opacity-40">
                  Accept
                </button>
                <button onClick={() => onDecide(r.id, false)} disabled={busyReq === r.id} aria-label={`Decline ${r.displayName}`} className="w-[34px] h-[34px] rounded-full bg-surface-2 text-warm-gray text-[14px] disabled:opacity-40">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {admins.length > 0 && (
        <>
          <p className="text-[12px] font-semibold text-warm-gray mt-5 px-0.5">Admins</p>
          <div className={`mt-2 ${card} overflow-hidden`}>{admins.map(row)}</div>
        </>
      )}
      {regular.length > 0 && (
        <>
          <p className="text-[12px] font-semibold text-warm-gray mt-5 px-0.5">Members</p>
          <div className={`mt-2 ${card} overflow-hidden`}>{regular.map(row)}</div>
        </>
      )}
      {filtered.length === 0 && <p className="text-[13px] text-warm-gray text-center mt-8">No one matches “{query}”.</p>}

      {isAdmin && (
        <Link to={`/teams/${team.id}/settings`} className={`mt-5 ${card} px-4 py-3.5 flex items-center gap-3 active:bg-surface-2`}>
          <span className="w-9 h-9 rounded-full bg-surface-2 text-ink-2 flex items-center justify-center shrink-0" aria-hidden>
            <GearIcon size={17} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold text-graphite">Club settings</span>
            <span className="block text-[11.5px] text-warm-gray">League, joining, Call-up defaults, saved venues</span>
          </span>
          <span className="text-[18px] text-stone" aria-hidden>›</span>
        </Link>
      )}

      <button onClick={onLeave} className="block mx-auto mt-6 text-[12.5px] font-semibold text-loss px-3 py-2.5 active:opacity-70">
        Leave club
      </button>

      {person && (
        <BottomSheet onClose={() => setPerson(null)} title={person.displayName} variant="card">
          <div className="rounded-[16px] bg-surface-2 overflow-hidden">
            <Link to={`/u/${person.userId}`} className="block px-4 py-3.5 text-[14px] text-graphite">
              View profile
            </Link>
            {can(person).promote && (
              <button
                onClick={() => {
                  const p = person;
                  setPerson(null);
                  void run(() => setMemberRole(team.id, p.userId, "admin"), `${p.displayName} is now an admin.`);
                }}
                className="w-full text-left px-4 py-3.5 border-t border-line text-[14px] font-semibold text-gold-ink"
              >
                Make admin
              </button>
            )}
            {can(person).demote && (
              <button
                onClick={() => {
                  const p = person;
                  setPerson(null);
                  void run(() => setMemberRole(team.id, p.userId, "member"), `${p.displayName} is a member again.`);
                }}
                className="w-full text-left px-4 py-3.5 border-t border-line text-[14px] text-graphite"
              >
                Make a member again
              </button>
            )}
            {can(person).remove && (
              <button
                onClick={() => {
                  const p = person;
                  setPerson(null);
                  setConfirm({
                    title: `Remove ${p.displayName}?`,
                    body: `${p.displayName} leaves ${team.name}. Their results stay in the history; they'd need the code to come back.`,
                    confirmLabel: `Remove ${p.displayName}`,
                    tone: "danger",
                    run: () => run(() => kickMember(team.id, p.userId), `${p.displayName} was removed.`),
                  });
                }}
                className="w-full text-left px-4 py-3.5 border-t border-line text-[14px] text-loss"
              >
                Remove from the club
              </button>
            )}
          </div>
          <button onClick={() => setPerson(null)} className="w-full text-[14px] font-semibold text-warm-gray py-3 mt-1.5">
            Cancel
          </button>
        </BottomSheet>
      )}
      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
