import { FormEvent, useEffect, useMemo, useState } from "react";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { Link, useNavigate } from "react-router-dom";
import { getMyTeams, createTeam, MyTeam } from "../../lib/supabase/teamQueries";
import { searchClubs, requestToJoin, joinByCode, ClubSearchResult } from "../../lib/supabase/clubJoinQueries";
import TabHeader from "../shell/TabHeader";

/**
 * Club — search at the top, your clubs below, create at the bottom.
 *
 * "How do I join a team?" was the most-asked question, and a permanent search
 * field is the plainest possible answer: it's visible the moment the tab opens,
 * with no button to discover first. Typing replaces the list with results
 * rather than pushing it down the page — the standard list-and-search
 * behaviour, so there's only ever one set of clubs on screen.
 *
 * One input takes a club code OR a club name. People get handed a code in a
 * WhatsApp group and have no idea it's a different kind of thing from a name;
 * making them pick the right box first is the app's problem, not theirs. A
 * code-shaped query offers the code action *and* runs the name search, so
 * guessing wrong costs nothing.
 */

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** Club codes are 6 uppercase alphanumerics — "looks like a code" is a hint, not a verdict. */
function looksLikeCode(q: string): boolean {
  return /^[A-Za-z0-9]{4,6}$/.test(q.trim());
}

export default function TeamsPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<MyTeam[] | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClubSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [joining, setJoining] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<unknown>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);

  function loadTeams() {
    getMyTeams().then(setTeams).catch(() => setTeams([]));
  }
  useEffect(loadTeams, []);

  // Debounced search — unchanged from v1.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchClubs(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const isSearching = query.trim().length > 0;
  const hasClubs = (teams?.length ?? 0) > 0;
  const codeCandidate = useMemo(() => looksLikeCode(query), [query]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { id } = await createTeam(name);
      navigate(`/teams/${id}`);
    } catch (err) {
      setCreateError(withFallback(err, "Couldn't create the club."));
    } finally {
      setCreating(false);
    }
  }

  async function handleRequest(clubId: string) {
    setBusyId(clubId);
    try {
      await requestToJoin(clubId);
      setResults((rs) => rs.map((r) => (r.id === clubId ? { ...r, requested: true } : r)));
    } catch (err) {
      setJoinError(withFallback(err, "Couldn't send the request."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleJoinByCode(raw: string) {
    const c = raw.trim();
    if (!c) return;
    setJoining(true);
    setJoinMsg(null);
    setJoinError(null);
    try {
      const res = await joinByCode(c);
      if (res.alreadyMember) navigate(`/teams/${res.clubId}`);
      else
        setJoinMsg(
          res.alreadyRequested
            ? `You've already asked to join ${res.name}.`
            : `Request sent to ${res.name} — an admin will confirm.`,
        );
      setQuery("");
      loadTeams();
    } catch (err) {
      setJoinError(withFallback(err, "No club has that code."));
    } finally {
      setJoining(false);
    }
  }

  return (
    <>
      <TabHeader />

      <div className="px-5 anim-fade">
        <h1 className="font-serif text-[26px] font-medium tracking-tight text-graphite mb-3.5">Club</h1>

        {/* ── Search: always here, always a field ────────────────────────── */}
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-warm-gray pointer-events-none" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setJoinError(null);
              setJoinMsg(null);
            }}
            placeholder="Club name or code"
            aria-label="Search for a club by name, or enter a club code"
            className="w-full rounded-2xl border border-line bg-surface pl-10 pr-10 py-3 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
          />
          {isSearching && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-warm-gray flex items-center justify-center text-[15px] leading-none active:scale-90 transition-transform"
            >
              ✕
            </button>
          )}
        </div>

        {/* A code-shaped query gets its own action, without suppressing the name
            search — we don't know which they meant, so we offer both. */}
        {codeCandidate && (
          <button
            type="button"
            onClick={() => handleJoinByCode(query)}
            disabled={joining}
            className="w-full mt-2 flex items-center gap-3 rounded-2xl border border-gold/40 bg-gold-soft/50 px-3.5 py-3 text-left active:scale-[0.995] transition-transform disabled:opacity-50 anim-fade"
          >
            <span className="w-[34px] h-[34px] rounded-[11px] bg-gold-soft border border-[#e6d6ac] text-gold-ink flex items-center justify-center shrink-0">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 7h3a5 5 0 0 1 0 10h-3M9 17H6A5 5 0 0 1 6 7h3M8 12h8" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] font-semibold text-graphite">{joining ? "Checking…" : "Join with code"}</b>
              <span className="block text-[11.5px] text-warm-gray font-mono tracking-[0.15em] uppercase">{query.trim()}</span>
            </span>
            <span className="text-gold-ink text-[16px] shrink-0" aria-hidden>›</span>
          </button>
        )}

        {joinMsg && <p className="text-[12px] text-win mt-2">{joinMsg}</p>}
        <ErrorNote error={joinError} where="TeamsPage.join" className="mt-2" />

        {/* ── Results while searching, your clubs otherwise ──────────────── */}
        <div className="mt-4">
          {isSearching ? (
            <div className="anim-fade">
              {searching && <p className="text-[11px] text-warm-gray mb-2">Searching…</p>}
              {results.length > 0 ? (
                <div className="space-y-2">
                  {results.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3">
                      <Link to={`/teams/${c.id}`} className="flex-1 min-w-0 active:opacity-70">
                        <b className="block text-[14px] font-semibold text-graphite truncate">{c.name}</b>
                        <p className="text-[11px] text-warm-gray mt-0.5">
                          {c.memberCount} {c.memberCount === 1 ? "member" : "members"} · view club
                        </p>
                      </Link>
                      {c.isMember ? (
                        <Link to={`/teams/${c.id}`} className="shrink-0 text-[12px] font-semibold text-gold-ink px-2">Open</Link>
                      ) : c.requested ? (
                        <span className="shrink-0 text-[12px] font-semibold text-warm-gray px-2">Requested</span>
                      ) : (
                        <button
                          onClick={() => handleRequest(c.id)}
                          disabled={busyId === c.id}
                          className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3.5 py-1.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
                        >
                          {busyId === c.id ? "…" : "Request"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                !searching && (
                  <p className="text-[12.5px] text-warm-gray leading-relaxed">
                    {codeCandidate
                      ? "No club by that name — if that's a code, use the button above."
                      : "No club by that name. If someone sent you a code, type that instead."}
                  </p>
                )
              )}
            </div>
          ) : teams === null ? (
            <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-[58px] rounded-2xl skeleton" />)}</div>
          ) : hasClubs ? (
            <div className="space-y-2">
              {teams.map((t) => (
                <Link
                  key={t.id}
                  to={`/teams/${t.id}`}
                  className="anim-rise flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 active:bg-surface-2 transition-colors shadow-[0_1px_2px_rgba(13,13,13,0.04)]"
                >
                  <div className="w-[38px] h-[38px] rounded-xl bg-gold-soft text-gold-ink flex items-center justify-center font-serif font-semibold text-[16px] overflow-hidden shrink-0">
                    {t.logoUrl ? <img src={t.logoUrl} alt="" className="w-full h-full object-cover" /> : t.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <b className="block text-[15px] font-semibold text-graphite truncate">{t.name}</b>
                    <p className="text-[11px] text-warm-gray mt-0.5">
                      {ROLE_LABEL[t.myRole]} · {t.memberCount} {t.memberCount === 1 ? "member" : "members"}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-6 text-center">
              <p className="text-[13px] text-ink-2 leading-relaxed">
                You're not in a club yet.
              </p>
              <p className="text-[12.5px] text-warm-gray leading-relaxed mt-1.5">
                Clubs keep a league table, schedule sessions and track champions. Search above for the one you play with —
                or start your own below.
              </p>
            </div>
          )}
        </div>

        {/* ── Create, at the bottom ──────────────────────────────────────── */}
        <div className="mt-5">
          {showCreate ? (
            <form onSubmit={handleCreate} className="rounded-2xl border border-line bg-surface p-3 anim-fade">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-ink">Create a club</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setCreateError(null);
                  }}
                  className="text-[12px] font-semibold text-warm-gray active:opacity-70"
                >
                  Cancel
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={60}
                  autoFocus
                  placeholder="Club name"
                  className="flex-1 min-w-0 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[16px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
                />
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="shrink-0 rounded-xl bg-graphite text-ivory text-[13px] font-semibold px-4 disabled:opacity-40 active:scale-[0.98] transition-transform"
                >
                  {creating ? "…" : "Create"}
                </button>
              </div>
              <ErrorNote error={createError} where="TeamsPage.create" className="mt-2" />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full text-center text-[13px] font-semibold text-warm-gray py-3 active:opacity-70"
            >
              Or create your own club
            </button>
          )}
        </div>
      </div>
    </>
  );
}
