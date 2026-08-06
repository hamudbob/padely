import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getMyTeams, createTeam, MyTeam } from "../../lib/supabase/teamQueries";
import { searchClubs, requestToJoin, joinByCode, ClubSearchResult } from "../../lib/supabase/clubJoinQueries";
import { useBackNav } from "../../lib/useBackNav";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export default function TeamsPage() {
  const navigate = useNavigate();
  const back = useBackNav("/profile");
  const [teams, setTeams] = useState<MyTeam[] | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClubSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  function loadTeams() {
    getMyTeams().then(setTeams).catch(() => setTeams([]));
  }
  useEffect(loadTeams, []);

  // Debounced search.
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
      setCreateError(err instanceof Error ? err.message : "Couldn't create the team.");
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
      setJoinError(err instanceof Error ? err.message : "Couldn't send the request.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleJoinByCode(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setJoining(true);
    setJoinMsg(null);
    setJoinError(null);
    try {
      const res = await joinByCode(c);
      if (res.alreadyMember) navigate(`/teams/${res.clubId}`);
      else setJoinMsg(res.alreadyRequested ? `You've already asked to join ${res.name}.` : `Request sent to ${res.name} — an admin will confirm.`);
      setCode("");
      loadTeams();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't find that team.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade">
      <div className="flex items-center justify-between mb-5">
        <button onClick={back} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</button>
        <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
        <div className="w-9" />
      </div>

      <h1 className="font-serif text-[26px] font-medium tracking-tight text-graphite mb-4">Teams</h1>

      {/* Create */}
      <form onSubmit={handleCreate} className="rounded-2xl border border-line bg-surface p-3 mb-5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-ink mb-2">Create a team</p>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            placeholder="Team name"
            className="flex-1 min-w-0 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15"
          />
          <button type="submit" disabled={creating || !newName.trim()} className="shrink-0 rounded-xl bg-graphite text-ivory text-[13px] font-semibold px-4 disabled:opacity-40 active:scale-[0.98] transition-transform">
            {creating ? "…" : "Create"}
          </button>
        </div>
        {createError && <p className="text-[11px] text-loss mt-1.5">{createError}</p>}
      </form>

      {/* My teams */}
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Your teams</p>
      {teams === null ? (
        <div className="space-y-2 mb-6">
          {[0, 1].map((i) => <div key={i} className="h-[58px] rounded-2xl skeleton" />)}
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-6 text-center mb-6">
          <p className="text-[13px] text-warm-gray">You're not in a team yet — create one above or find one below.</p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {teams.map((t) => (
            <Link key={t.id} to={`/teams/${t.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 active:bg-surface-2 transition-colors shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
              <div className="w-[38px] h-[38px] rounded-xl bg-gold-soft text-gold-ink flex items-center justify-center font-serif font-semibold text-[16px] overflow-hidden shrink-0">
                {t.logoUrl ? <img src={t.logoUrl} alt="" className="w-full h-full object-cover" /> : t.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <b className="block text-[15px] font-semibold text-graphite truncate">{t.name}</b>
                <p className="text-[11px] text-warm-gray mt-0.5">{ROLE_LABEL[t.myRole]} · {t.memberCount} {t.memberCount === 1 ? "member" : "members"}</p>
              </div>
              <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </Link>
          ))}
        </div>
      )}

      {/* Find a team */}
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Find a team</p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name"
        className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15 mb-2"
      />
      {searching && <p className="text-[11px] text-warm-gray mb-2">Searching…</p>}
      {results.length > 0 && (
        <div className="space-y-2 mb-4">
          {results.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3">
              <Link to={`/teams/${c.id}`} className="flex-1 min-w-0 active:opacity-70">
                <b className="block text-[14px] font-semibold text-graphite truncate">{c.name}</b>
                <p className="text-[11px] text-warm-gray mt-0.5">{c.memberCount} {c.memberCount === 1 ? "member" : "members"} · view team</p>
              </Link>
              {c.isMember ? (
                <Link to={`/teams/${c.id}`} className="shrink-0 text-[12px] font-semibold text-gold-ink px-2">Open</Link>
              ) : c.requested ? (
                <span className="shrink-0 text-[12px] font-semibold text-warm-gray px-2">Requested</span>
              ) : (
                <button onClick={() => handleRequest(c.id)} disabled={busyId === c.id} className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3.5 py-1.5 disabled:opacity-40 active:scale-[0.98] transition-transform">
                  {busyId === c.id ? "…" : "Request"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Join by code */}
      <form onSubmit={handleJoinByCode} className="mt-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Have a team code?</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC123"
            className="flex-1 min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 font-mono tracking-[0.2em] text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15"
          />
          <button type="submit" disabled={joining || code.trim().length < 4} className="shrink-0 rounded-xl border-[1.5px] border-graphite text-graphite bg-surface text-[13px] font-semibold px-4 disabled:opacity-40 active:scale-[0.98] transition-transform">
            {joining ? "…" : "Join"}
          </button>
        </div>
        {joinMsg && <p className="text-[11px] text-win mt-1.5">{joinMsg}</p>}
        {joinError && <p className="text-[11px] text-loss mt-1.5">{joinError}</p>}
      </form>
    </div>
  );
}
