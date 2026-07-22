import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { signOutHost, updateHostName, updateHostPrefs } from "../../lib/supabase/auth";
import { listHostSessions, HostSessionSummary } from "../../lib/supabase/hostSessionsQueries";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  mix_mexicano: "Mix Mexicano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return `Today · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

type RoleTab = "host" | "player" | "spectator";

/**
 * Padelier dashboard — the personal hub reached from the home avatar. A single
 * place that reflects that one person can host, play, AND spectate: identity +
 * editable name, big-picture stat tiles, quick actions into each role, and a
 * tabbed session list (Host / Player / Spectator).
 *
 * Only the Host tab has real data today; Player and Spectator show intentional
 * "coming" empty states — the frame Phase 3's player-join and spectator-join
 * features slot straight into.
 */
export default function ProfilePage() {
  const { user } = useHostSession();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<HostSessionSummary[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [tab, setTab] = useState<RoleTab>("host");

  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [signingOut, setSigningOut] = useState(false);

  // Default playing preferences, saved to the account so a signed-in join needs
  // zero input. Seeded from metadata (default Right / Male until set).
  const [prefSide, setPrefSide] = useState<"L" | "R">("R");
  const [prefGender, setPrefGender] = useState<"M" | "F">("M");
  const [savingPrefs, setSavingPrefs] = useState(false);

  const metadataName = (user?.user_metadata?.name as string | undefined)?.trim() || "";
  const emailPrefix = (user?.email ?? "").split("@")[0];

  // Keep the shown name in sync with the account, unless mid-edit.
  useEffect(() => {
    if (!editingName) setDisplayName(metadataName || emailPrefix || "Player");
  }, [metadataName, emailPrefix, editingName]);

  // Seed preference toggles from the account.
  useEffect(() => {
    const md = user?.user_metadata ?? {};
    setPrefSide(md.preferred_side === "L" ? "L" : "R");
    setPrefGender(md.gender === "F" ? "F" : "M");
  }, [user]);

  async function saveSide(side: "L" | "R") {
    setPrefSide(side);
    setSavingPrefs(true);
    try {
      await updateHostPrefs({ preferredSide: side });
    } catch {
      /* keep the optimistic value; a retry will re-save */
    } finally {
      setSavingPrefs(false);
    }
  }
  async function saveGender(gender: "M" | "F") {
    setPrefGender(gender);
    setSavingPrefs(true);
    try {
      await updateHostPrefs({ gender });
    } catch {
      /* optimistic */
    } finally {
      setSavingPrefs(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    setSessionsLoading(true);
    listHostSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, [user]);

  const hostedSessions = sessions ?? [];
  const liveCount = hostedSessions.filter((s) => s.status === "live").length;
  const hostedCount = hostedSessions.length;
  const playedCount = 0; // Phase 3 — player join
  const watchedCount = 0; // Phase 3 — spectator join

  async function handleSaveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Name can't be empty.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await updateHostName(trimmed);
      setDisplayName(trimmed);
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Could not save your name.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutHost();
      navigate("/");
    } finally {
      setSigningOut(false);
    }
  }

  const avatarLetter = (displayName || user?.email || "?").charAt(0).toUpperCase();

  const roleChips: { key: RoleTab; label: string; on: boolean }[] = [
    { key: "host", label: "Host", on: hostedCount > 0 },
    { key: "player", label: "Player", on: playedCount > 0 },
    { key: "spectator", label: "Spectator", on: watchedCount > 0 },
  ];

  const tiles = [
    { label: "Hosted", value: hostedCount },
    { label: "Played", value: playedCount },
    { label: "Watched", value: watchedCount },
  ];

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 safe-top safe-bottom anim-fade">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          aria-label="Back"
          className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
        >
          ‹
        </Link>
        <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier
          <span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
        <div className="w-9" />
      </div>

      {/* Identity */}
      <div className="flex items-center gap-3.5 mb-5">
        <div className="w-[58px] h-[58px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[24px] font-semibold shrink-0">
          {avatarLetter}
        </div>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  maxLength={40}
                  className="flex-1 min-w-0 rounded-xl border border-line bg-surface px-3 py-1.5 text-[16px] font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-graphite/15"
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3 py-1.5 disabled:opacity-50"
                >
                  {savingName ? "…" : "Save"}
                </button>
                <button onClick={() => setEditingName(false)} className="shrink-0 text-[12px] font-semibold text-warm-gray px-1">
                  Cancel
                </button>
              </div>
              {nameError && <p className="text-[11px] text-loss mt-1">{nameError}</p>}
            </div>
          ) : (
            <button
              onClick={() => {
                setNameDraft(displayName);
                setNameError(null);
                setEditingName(true);
              }}
              className="flex items-center gap-1.5 max-w-full"
            >
              <h1 className="font-serif text-[23px] font-semibold text-graphite tracking-tight truncate">{displayName}</h1>
              <svg className="w-[15px] h-[15px] text-warm-gray shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          <p className="text-[12.5px] text-warm-gray mt-0.5 truncate">{user?.email}</p>
          <div className="flex gap-1.5 mt-2">
            {roleChips.map((r) => (
              <span
                key={r.key}
                className={`text-[9px] font-bold uppercase tracking-[0.08em] px-2 py-[3px] rounded-full ${
                  r.on ? "bg-graphite text-ivory" : "bg-surface-2 border border-line text-ink-2"
                }`}
              >
                {r.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Big-picture stat tiles */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface py-3 px-2 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            <b className="block font-mono tnum text-[24px] font-semibold text-graphite leading-none">{t.value}</b>
            <span className="block text-[9.5px] font-bold uppercase tracking-[0.09em] text-warm-gray mt-1.5">{t.label}</span>
          </div>
        ))}
      </div>

      {/* Quick actions into each role */}
      <div className="space-y-2 mb-6">
        <Link to="/create" className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 active:bg-surface-2 transition-colors shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <span className="w-[34px] h-[34px] rounded-[11px] bg-graphite text-gold flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px] font-semibold text-graphite">Host a session</b>
            <span className="block text-[11px] text-warm-gray">Create &amp; run a new one</span>
          </span>
          <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </Link>

        <Link to="/join" className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 active:bg-surface-2 transition-colors shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <span className="w-[34px] h-[34px] rounded-[11px] bg-gold-soft text-gold-ink flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px] font-semibold text-graphite">Join as a player</b>
            <span className="block text-[11px] text-warm-gray">Enter a code to play &amp; score</span>
          </span>
          <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </Link>

        <Link to="/join" className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 active:bg-surface-2 transition-colors shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <span className="w-[34px] h-[34px] rounded-[11px] bg-surface-2 border border-line text-ink-2 flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="2.6" /></svg>
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px] font-semibold text-graphite">Watch live</b>
            <span className="block text-[11px] text-warm-gray">Follow a session as spectator</span>
          </span>
          <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </Link>
      </div>

      {/* Playing preferences — used to auto-fill a signed-in join */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Playing preferences</p>
        {savingPrefs && <span className="text-[10px] text-warm-gray">saving…</span>}
      </div>
      <div className="flex gap-2 mb-6">
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-gray mb-1.5">Side</p>
          <div className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
            {(["L", "R"] as const).map((s) => (
              <button
                key={s}
                onClick={() => saveSide(s)}
                className={`flex-1 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors ${prefSide === s ? "bg-graphite text-ivory" : "text-ink-2 active:bg-surface-2"}`}
              >
                {s === "L" ? "Left" : "Right"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-gray mb-1.5">Gender</p>
          <div className="flex gap-1 rounded-2xl border border-line bg-surface p-1">
            {(["M", "F"] as const).map((g) => (
              <button
                key={g}
                onClick={() => saveGender(g)}
                className={`flex-1 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors ${prefGender === g ? "bg-graphite text-ivory" : "text-ink-2 active:bg-surface-2"}`}
              >
                {g === "M" ? "Male" : "Female"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Role tabs + session list */}
      <div className="flex gap-1 mb-3 rounded-2xl border border-line bg-surface p-1">
        {(["host", "player", "spectator"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl px-2 py-2 text-[12.5px] font-semibold capitalize transition-colors ${
              tab === t ? "bg-graphite text-ivory" : "text-ink-2 active:bg-surface-2"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "host" && (
        <>
          {sessionsLoading && !sessions && (
            <div className="rounded-2xl border border-line bg-surface overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-t border-line first:border-t-0">
                  <span className="w-2 h-2 rounded-full skeleton shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-1/3 rounded skeleton" />
                    <div className="h-2.5 w-2/3 rounded skeleton" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {sessions && hostedCount === 0 && (
            <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-8 text-center">
              <p className="text-sm text-warm-gray">You haven't hosted a session yet — create one to get started.</p>
            </div>
          )}

          {sessions && hostedCount > 0 && (
            <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
              {[...hostedSessions].map((s) => (
                <Link
                  key={s.id}
                  to={`/session/${s.id}/host`}
                  className="flex items-center gap-3 px-4 py-3.5 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      s.status === "live" ? "bg-court-lime shadow-[0_0_0_3px_rgba(196,226,75,0.28)]" : "bg-stone"
                    }`}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <b className="block text-[15px] font-semibold text-graphite truncate">{s.name}</b>
                    <p className="text-[11px] text-warm-gray mt-0.5 truncate">
                      {FORMAT_LABELS[s.format] ?? s.format} · Code <span className="font-mono tnum">{s.joinCode}</span> · {formatSessionDate(s.createdAt)}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
          {liveCount > 0 && (
            <p className="text-[11px] text-warm-gray mt-2 text-center">
              {liveCount} live right now.
            </p>
          )}
        </>
      )}

      {tab === "player" && (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] font-semibold text-ink-2">No games yet</p>
          <p className="text-[12px] text-warm-gray mt-1.5 leading-relaxed">
            Join a session as a player with a code and your matches, scores and standings will show up here.
          </p>
          <Link to="/join" className="inline-flex mt-4 items-center justify-center rounded-full px-4 py-2.5 font-semibold text-[13px] border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform">
            Join by code
          </Link>
        </div>
      )}

      {tab === "spectator" && (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] font-semibold text-ink-2">Not watching anything</p>
          <p className="text-[12px] text-warm-gray mt-1.5 leading-relaxed">
            Follow a live session as a spectator and it'll appear here so you can jump back to the action.
          </p>
        </div>
      )}

      {/* Account */}
      <div className="flex items-center justify-between border-t border-line mt-6 pt-4">
        <p className="text-[12px] text-warm-gray truncate">Signed in as {user?.email}</p>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="shrink-0 ml-2 text-[12px] font-semibold text-ink-2 border border-line rounded-full px-3 py-1.5 bg-surface active:bg-surface-2 disabled:opacity-50"
        >
          {signingOut ? "…" : "Log out"}
        </button>
      </div>
    </div>
  );
}
