import { useEffect, useRef, useState, ChangeEvent } from "react";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { Link, useNavigate } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import TabHeader from "../shell/TabHeader";
import {
  RatingStrip,
  RecordCard,
  PeerRow,
  TrendCard,
  SectionHeading,
  StatCard,
  FormResult,
} from "./playerStats";
import { listHostSessions, HostSessionSummary } from "../../lib/supabase/hostSessionsQueries";
import { deleteSession } from "../../lib/supabase/sessionActions";
import { getMyPlayerSessions, PlayerSession } from "../../lib/supabase/playerJoinQueries";
import { getMyProfile, updateMyProfile, uploadAvatar, Profile } from "../../lib/supabase/profileQueries";
import { getPlayerInsights, getRatingHistory, PlayerInsights, RatingPoint } from "../../lib/supabase/insightsQueries";
import RecordSheet from "./RecordSheet";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  side_americano: "Fixed Position",
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

type RoleTab = "host" | "player";

/**
 * You — the reflective half of the app, and the second of the three tabs.
 *
 * Reads top to bottom as an answer to "how am I doing?": who you are, then
 * progress (rating and trend — the question people actually ask), then the
 * record, then every session you've played, filterable by the role you were in.
 *
 * What used to be here and isn't any more: the teams shortcut (Club is a tab
 * now), the quick-action rows into each role (navigation furniture that only
 * existed because there was no tab bar), the sign-out footer and the playing
 * preferences — both of which live behind the gear, in Settings.
 */
export default function ProfilePage() {
  const { user } = useHostSession();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<HostSessionSummary[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  // Multi-select delete for the host-sessions tab.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSessions, setDeletingSessions] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [playerSessions, setPlayerSessions] = useState<PlayerSession[] | null>(null);
  const [tab, setTab] = useState<RoleTab>("host");
  const [recordOpen, setRecordOpen] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<unknown>(null);


  // Phase 1: profile (avatar + global rating), insights, and rating trend.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [insights, setInsights] = useState<PlayerInsights | null>(null);
  const [history, setHistory] = useState<RatingPoint[]>([]);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const metadataName = (user?.user_metadata?.name as string | undefined)?.trim() || "";
  const emailPrefix = (user?.email ?? "").split("@")[0];

  // Keep the shown name in sync with the account, unless mid-edit.
  useEffect(() => {
    if (!editingName) setDisplayName(metadataName || emailPrefix || "Player");
  }, [metadataName, emailPrefix, editingName]);


  function reloadSessions() {
    setSessionsLoading(true);
    listHostSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }
  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    if (!window.confirm(`Delete ${ids.length} session${ids.length === 1 ? "" : "s"}? This permanently removes them and their scores — it can't be undone.`)) return;
    setDeletingSessions(true);
    setDeleteError(null);
    const removed = new Set<string>();
    let failed = 0;
    let firstError: string | null = null;
    // SEQUENTIALLY, oldest first — not Promise.allSettled.
    //
    // delete_session_and_unrate (0040) decides how to reverse a session's rating
    // by asking whether it is the player's MOST RECENT rated session: if it is,
    // restore the stored snapshot exactly; if not, subtract that session's
    // delta. Run concurrently, that question gets answered against a database
    // mid-flight, so two rated sessions deleted in one batch could both read
    // "I'm the most recent" and the resulting rating would depend on which
    // transaction committed first. Deleting one at a time makes the outcome
    // deterministic and correct: each call sees the state the previous one left.
    //
    // Oldest first so the newest deletion is the one that restores a snapshot —
    // the exact path — rather than subtracting from a number that has already
    // been rewound.
    const ordered = [...ids].sort((a, b) => {
      const at = sessions?.find((s) => s.id === a)?.createdAt ?? "";
      const bt = sessions?.find((s) => s.id === b)?.createdAt ?? "";
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
    for (const id of ordered) {
      try {
        const n = await deleteSession(id);
        if (n > 0) removed.add(id);
        else failed += 1;
      } catch (err) {
        failed += 1;
        if (!firstError) firstError = err instanceof Error ? err.message : String(err);
      }
    }
    // Optimistically drop the ones that really deleted, then reconcile from server.
    if (removed.size > 0) setSessions((prev) => (prev ? prev.filter((s) => !removed.has(s.id)) : prev));
    if (failed > 0) {
      setDeleteError(
        firstError
          ? `Couldn't delete ${failed}: ${firstError}`
          : `${failed} session${failed === 1 ? "" : "s"} couldn't be deleted — you may not have permission, or they were already gone.`,
      );
      setSelectedIds(new Set(ids.filter((id) => !removed.has(id))));
    } else {
      exitSelectMode();
    }
    setDeletingSessions(false);
    reloadSessions();
  }

  useEffect(() => {
    if (!user) return;
    setSessionsLoading(true);
    listHostSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
    getMyPlayerSessions()
      .then(setPlayerSessions)
      .catch(() => setPlayerSessions([]));
    getMyProfile()
      .then((p) => {
        setProfile(p);
        if (p && !editingName) setDisplayName(p.displayName);
      })
      .catch(() => setProfile(null));
    getPlayerInsights(user.id)
      .then(setInsights)
      .catch(() => setInsights(null));
    getRatingHistory(user.id)
      .then(setHistory)
      .catch(() => setHistory([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const hostedSessions = sessions ?? [];
  const liveCount = hostedSessions.filter((s) => s.status === "live").length;
  const hostedCount = hostedSessions.length;
  const playedCount = playerSessions?.length ?? 0;

  async function handleSaveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Name can't be empty.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await updateMyProfile({ displayName: trimmed });
      setProfile(updated);
      setDisplayName(updated.displayName);
      setEditingName(false);
    } catch (err) {
      setNameError(withFallback(err, "Could not save your name."));
    } finally {
      setSavingName(false);
    }
  }

  async function handleAvatarPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const url = await uploadAvatar(file);
      setProfile((p) => (p ? { ...p, avatarUrl: url } : p));
    } catch (err) {
      setAvatarError(withFallback(err, "Couldn't upload that photo."));
    } finally {
      setAvatarBusy(false);
    }
  }


  const avatarLetter = (displayName || user?.email || "?").charAt(0).toUpperCase();

  const roleChips: { key: RoleTab; label: string; on: boolean }[] = [
    { key: "host", label: "Host", on: hostedCount > 0 },
    { key: "player", label: "Player", on: playedCount > 0 },
  ];

  const tiles = [
    { label: "Hosted", value: hostedCount },
    { label: "Played", value: playedCount },
  ];

  return (
    <div className="px-5 anim-fade">
      <div className="-mx-5">
        <TabHeader
          trailing={
            <Link
              to="/settings"
              aria-label="Settings"
              className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95 transition-transform"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
          }
        />
      </div>

      {/* Identity */}
      <div className="flex items-center gap-3.5 mb-5">
        <div className="shrink-0">
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarPick} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarBusy}
            aria-label="Change profile photo"
            className="relative w-[58px] h-[58px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[24px] font-semibold overflow-hidden active:scale-95 transition-transform"
          >
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              avatarLetter
            )}
            <span className="absolute bottom-0 right-0 w-[19px] h-[19px] rounded-full bg-gold text-graphite border-2 border-ivory flex items-center justify-center" aria-hidden>
              {avatarBusy ? (
                <span className="w-2.5 h-2.5 border-2 border-graphite/40 border-t-graphite rounded-full animate-spin" />
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="3.2" /></svg>
              )}
            </span>
          </button>
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
                  className="flex-1 min-w-0 rounded-xl border border-line bg-surface px-3 py-1.5 text-[16px] font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
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
              <ErrorNote error={nameError} where="ProfilePage.name" className="mt-2" />
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

      <ErrorNote error={avatarError} where="ProfilePage.avatar" className="mt-2" />

      {/* Bio + join date. The bio is what you choose to say; the join date is
          passive credibility. They do different jobs, so both stay — one
          replacing the other would lose something. */}
      <div className="mb-5">
        {profile?.bio ? (
          <p className="text-[13.5px] leading-relaxed text-ink-2">{profile.bio}</p>
        ) : (
          <Link to="/settings" className="text-[13px] text-warm-gray active:opacity-70">
            <span className="text-gold-ink font-semibold">Add a line about yourself</span> — it shows on your public profile.
          </Link>
        )}
        {profile?.createdAt && (
          <p className="text-[11.5px] text-warm-gray mt-1.5">
            Playing since{" "}
            {new Date(profile.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </p>
        )}
      </div>

      {/* ── Progress ────────────────────────────────────────────────────
          Above the record on purpose: "am I improving?" is the question
          people actually ask, and the tally is the supporting detail.
          Built from the SAME components as the public profile so the two
          screens can't drift apart again — see features/profile/playerStats. */}
      <RatingStrip
        rating={profile?.rating ?? 1500}
        provisional={!!profile && (profile.ratingDeviation > 110 || profile.ratingGames < 5)}
        games={profile?.ratingGames ?? 0}
      />

      {history.length >= 2 && (
        <>
          <SectionHeading>Rating trend</SectionHeading>
          <TrendCard
            rating={profile?.rating ?? 1500}
            points={history.map((h) => h.rating)}
            lastDelta={history[history.length - 1].delta}
          />
        </>
      )}

      <SectionHeading>Record</SectionHeading>
      <RecordCard
        wins={insights?.wins ?? 0}
        losses={insights?.losses ?? 0}
        draws={insights?.draws ?? 0}
        form={(insights?.form ?? []) as FormResult[]}
        emptyLabel="Play a session and your record shows up here."
        onOpen={insights ? () => setRecordOpen(true) : undefined}
      />
      {recordOpen && insights && <RecordSheet insights={insights} onClose={() => setRecordOpen(false)} />}

      {/* ── Partners & rivals — YOUR page only ──────────────────────────
          These name another player and reveal their head-to-head record.
          Fair to show you about your own games; not something a stranger
          should read off a shared link about someone who never agreed to
          it. get_public_profile deliberately doesn't return this data.

          Three each rather than one, because one name is a verdict and three
          is a picture — and because the old single "best partner" was often
          just whoever you had played twice. Ranked now by a Wilson lower
          bound with a four-game minimum, so a long good run outranks a short
          perfect one. */}
      {insights && (insights.topPartners.length > 0 || insights.topRivals.length > 0 || insights.mostPlayedWith) && (
        <>
          <SectionHeading>Partners &amp; rivals</SectionHeading>

          {insights.topPartners.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray px-1 mb-1.5">
                You win most with
              </p>
              <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
                {insights.topPartners.map((p) => (
                  <PeerRow key={p.key} peer={p} kind="partner" />
                ))}
              </div>
            </>
          )}

          {insights.topRivals.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray px-1 mt-4 mb-1.5">
                You struggle most against
              </p>
              <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
                {insights.topRivals.map((p) => (
                  <PeerRow key={p.key} peer={p} kind="rival" />
                ))}
              </div>
            </>
          )}

          {/* Frequency, which is a different fact from chemistry — and on a
              quiet profile it is the only one of the three that can be
              answered yet. */}
          {insights.mostPlayedWith && (
            <div className="rounded-2xl bg-surface px-4 py-3.5 mt-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Most played with</p>
              <p className="text-[14px] text-ink-2 mt-1.5">
                <span className="font-semibold text-graphite">{insights.mostPlayedWith.fullName}</span>
                {" — "}
                <span className="font-mono tnum">{insights.mostPlayedWith.matches}</span>{" "}
                {insights.mostPlayedWith.matches === 1 ? "game" : "games"} on the same court
              </p>
            </div>
          )}

          {insights.topPartners.length === 0 && insights.topRivals.length === 0 && (
            <p className="text-[12px] text-warm-gray px-1 mt-3 leading-relaxed">
              Play four games with the same person and they will start showing up here as a partner or a rival. Fewer
              than that and the numbers say more about luck than about either of you.
            </p>
          )}
        </>
      )}

      {/* ── Sessions ────────────────────────────────────────────────── */}
      <SectionHeading>Sessions</SectionHeading>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Played", value: insights?.sessionsPlayed ?? playedCount },
          { label: "Hosted", value: hostedCount },
          { label: "Games", value: insights?.matchesPlayed ?? 0 },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl bg-surface py-3 px-2 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            <b className="block font-mono tnum text-[22px] font-semibold text-graphite leading-none">{t.value}</b>
            <span className="block text-[9.5px] font-bold uppercase tracking-[0.09em] text-warm-gray mt-1.5">{t.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-7" />

      {/* Role tabs + session list */}
      <div className="flex gap-1 mb-3 rounded-2xl border border-line bg-surface p-1">
        {(["host", "player"] as const).map((t) => (
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
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">
                  {selectMode ? `${selectedIds.size} selected` : `${hostedCount} session${hostedCount === 1 ? "" : "s"}`}
                </span>
                {selectMode ? (
                  <div className="flex items-center gap-3">
                    <button onClick={exitSelectMode} className="text-[12px] font-semibold text-ink-2 active:opacity-70">Cancel</button>
                    <button
                      onClick={deleteSelected}
                      disabled={selectedIds.size === 0 || deletingSessions}
                      className="text-[12px] font-semibold text-loss disabled:opacity-40 active:opacity-70"
                    >
                      {deletingSessions ? "Deleting…" : `Delete${selectedIds.size ? ` (${selectedIds.size})` : ""}`}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setSelectMode(true)} className="text-[12px] font-semibold text-gold-ink active:opacity-70">Select</button>
                )}
              </div>
              <ErrorNote error={deleteError} where="ProfilePage.delete" />
              <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
                {[...hostedSessions].map((s) => {
                  const selected = selectedIds.has(s.id);
                  const rowClass = "flex items-center gap-3 px-4 py-3.5 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors w-full text-left";
                  const inner = (
                    <>
                      {selectMode && (
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            selected ? "bg-graphite border-graphite text-ivory" : "border-stone bg-surface text-transparent"
                          }`}
                          aria-hidden
                        >
                          ✓
                        </span>
                      )}
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
                      {!selectMode && (
                        <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      )}
                    </>
                  );
                  return selectMode ? (
                    <button key={s.id} type="button" onClick={() => toggleSelected(s.id)} className={rowClass}>
                      {inner}
                    </button>
                  ) : (
                    <Link key={s.id} to={s.status === "ended" ? `/session/${s.id}/final` : `/session/${s.id}/host`} className={rowClass}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            </>
          )}
          {liveCount > 0 && (
            <p className="text-[11px] text-warm-gray mt-2 text-center">
              {liveCount} live right now.
            </p>
          )}
        </>
      )}

      {tab === "player" &&
        (playerSessions && playerSessions.length > 0 ? (
          <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            {playerSessions.map((s) => (
              <Link
                key={s.id}
                // One destination per state: an ended session always opens the
                // podium (same page the host and a shared link land on), a live
                // one opens the spectator view.
                to={s.status === "ended" ? `/session/${s.id}/final` : `/live/${s.publicToken}`}
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
                    {FORMAT_LABELS[s.format] ?? s.format} · {s.status === "live" ? "live now" : "ended"} · {formatSessionDate(s.createdAt)}
                  </p>
                </div>
                <svg className="w-4 h-4 text-stone shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-8 text-center">
            <p className="text-[13px] font-semibold text-ink-2">No games yet</p>
            <p className="text-[12px] text-warm-gray mt-1.5 leading-relaxed">
              Join a session as a player with a code and it'll show up here — you can tap in to follow the scores live.
            </p>
            <Link to="/watch" className="inline-flex mt-4 items-center justify-center rounded-full px-4 py-2.5 font-semibold text-[13px] border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform">
              Enter a code
            </Link>
          </div>
        ))}

    </div>
  );
}
