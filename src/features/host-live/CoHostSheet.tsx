import { useEffect, useMemo, useState } from "react";
import { BottomSheet } from "../shell/Sheet";
import PersonAvatar from "../shell/PersonAvatar";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { getTeamMembers } from "../../lib/supabase/teamQueries";
import { addCoHost, removeCoHost, CoHost } from "../../lib/offline/coHostSync";
import { shareUrl } from "../../lib/shareLink";
import type { SessionPeople } from "../../lib/supabase/sessionPeopleQueries";

/**
 * The host picks co-hosts. A co-host can enter scores and start the next
 * round — nothing else — for when the host is on court, or not there yet.
 *
 * Candidates are the session's club members. A session with no club offers
 * the players in it who have an account instead, since those are the only
 * people the host can be sure are actually there.
 */

interface Candidate {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export default function CoHostSheet({
  sessionId,
  sessionName,
  hostUserId,
  people,
  coHosts,
  onChange,
  onClose,
}: {
  sessionId: string;
  sessionName: string;
  hostUserId: string;
  people: SessionPeople | null;
  coHosts: CoHost[];
  onChange: () => void;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [source, setSource] = useState<"club" | "players">("club");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [shared, setShared] = useState<string | null>(null);

  const clubId = people?.clubId ?? null;

  useEffect(() => {
    let cancelled = false;
    const fromPlayers = (): Candidate[] =>
      people
        ? [...people.byPlayer.values()]
            .filter((p) => p.userId)
            .map((p) => ({ userId: p.userId as string, name: p.name, avatarUrl: p.avatarUrl }))
        : [];
    if (!clubId) {
      setSource("players");
      setCandidates(fromPlayers());
      return;
    }
    getTeamMembers(clubId)
      .then((members) => {
        if (cancelled) return;
        setSource("club");
        setCandidates(members.map((m) => ({ userId: m.userId, name: m.displayName, avatarUrl: m.avatarUrl })));
      })
      .catch(() => {
        if (cancelled) return;
        setSource("players");
        setCandidates(fromPlayers());
      });
    return () => {
      cancelled = true;
    };
  }, [clubId, people]);

  const chosen = useMemo(() => new Set(coHosts.map((c) => c.userId)), [coHosts]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    return (candidates ?? [])
      .filter((c) => c.userId !== hostUserId && !chosen.has(c.userId))
      .filter((c) => (seen.has(c.userId) ? false : (seen.add(c.userId), true)))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates, chosen, hostUserId, query]);

  async function run(userId: string, fn: () => Promise<void>) {
    setBusyId(userId);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(withFallback(err, "Could not update co-hosts."));
    } finally {
      setBusyId(null);
    }
  }

  async function share() {
    const outcome = await shareUrl(
      `/session/${sessionId}/score`,
      `Co-host ${sessionName}`,
      `You're co-hosting ${sessionName} on Padelier — enter scores and start the next round here:`,
    );
    setShared(outcome === "copied" ? "Link copied" : outcome === "failed" ? "Couldn't share — try again" : null);
  }

  return (
    <BottomSheet
      onClose={onClose}
      title="Co-hosts"
      subtitle="They can enter scores and start the next round. They can't change players, courts or settings, and can't end the session."
    >
      <ErrorNote error={error} where="CoHostSheet" className="mb-2" />

      {coHosts.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface mb-3 overflow-hidden">
          {coHosts.map((c, i) => (
            <div key={c.userId} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>
              <PersonAvatar name={c.displayName} avatarUrl={c.avatarUrl} linked size={30} />
              <b className="flex-1 min-w-0 truncate text-[14px] font-semibold text-graphite">{c.displayName}</b>
              <button
                onClick={() => run(c.userId, () => removeCoHost(sessionId, c.userId))}
                disabled={busyId === c.userId}
                className="text-[12px] font-semibold text-loss rounded-full border border-line bg-surface px-3 py-1.5 disabled:opacity-50"
              >
                {busyId === c.userId ? "…" : "Remove"}
              </button>
            </div>
          ))}
          <div className="border-t border-line px-3.5 py-2.5 flex items-center justify-between gap-2">
            <p className="text-[11px] text-warm-gray leading-snug">
              They'll see this session on their Play tab. Or send them the link.
            </p>
            <button
              onClick={share}
              className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3.5 py-1.5 active:scale-95 transition-transform"
            >
              Share link
            </button>
          </div>
          {shared && <p className="px-3.5 pb-2.5 text-[11px] text-ink-2">{shared}</p>}
        </div>
      )}

      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">
        {source === "club" ? "Add from your club" : "Add a player with an account"}
      </p>

      {candidates === null ? (
        <p className="text-[13px] text-warm-gray py-3">Loading…</p>
      ) : (
        <>
          {(candidates.length > 8 || query) && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-full border border-line bg-surface px-4 py-2 text-[14px] mb-2 outline-none focus:border-graphite"
            />
          )}
          {shown.length === 0 ? (
            <p className="text-[13px] text-warm-gray py-3">
              {query
                ? "Nobody by that name."
                : source === "club"
                  ? "Everyone in your club is already a co-host."
                  : "Nobody in this session has an account yet. Once someone joins with the code, you can pick them here."}
            </p>
          ) : (
            <div className="rounded-2xl border border-line bg-surface overflow-hidden max-h-[40vh] overflow-y-auto">
              {shown.map((c, i) => (
                <div key={c.userId} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>
                  <PersonAvatar name={c.name} avatarUrl={c.avatarUrl} linked size={30} />
                  <span className="flex-1 min-w-0 truncate text-[14px] text-graphite">{c.name}</span>
                  <button
                    onClick={() => run(c.userId, () => addCoHost(sessionId, c.userId))}
                    disabled={busyId === c.userId}
                    className="text-[12px] font-semibold text-ivory rounded-full bg-graphite px-3 py-1.5 disabled:opacity-50"
                  >
                    {busyId === c.userId ? "…" : "Add"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}
