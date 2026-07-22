import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { getHostLiveSnapshot, HostLiveSnapshot } from "../../lib/supabase/sessionQueries";
import { listJoinRequests, confirmJoinRequest, rejectJoinRequest, JoinRequest } from "../../lib/supabase/joinRequestQueries";
import { addLatePlayer, removePlayer } from "../../lib/supabase/manageActions";
import { startSession } from "../../lib/supabase/sessionActions";
import { useHostSession } from "../../lib/supabase/useHostSession";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  mix_mexicano: "Mix Mexicano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

/**
 * Pre-start LOBBY for a draft session (`/session/:id/lobby`). The join code is
 * already live, so this screen gathers players — typed at creation, plus anyone
 * who scans the QR / enters the code — before the host taps Start. Start calls
 * startSession, which generates Round 1 from whoever's actually in the roster.
 *
 * It polls the roster + pending requests every few seconds so joiners appear
 * without a refresh.
 */
export default function LobbyPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useHostSession();

  const [snapshot, setSnapshot] = useState<HostLiveSnapshot | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [starting, setStarting] = useState(false);

  const defaultRounds = (location.state as { roundCount?: number } | null)?.roundCount ?? 7;
  const [roundCount, setRoundCount] = useState(defaultRounds);
  const didInit = useRef(false);

  function reload() {
    if (!sessionId) return;
    getHostLiveSnapshot(sessionId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the lobby."));
    listJoinRequests(sessionId)
      .then(setJoinRequests)
      .catch(() => setJoinRequests([]));
  }

  useEffect(() => {
    reload();
    const t = window.setInterval(reload, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // If the session is already live (e.g. reloaded after Start), go to the host view.
  useEffect(() => {
    if (snapshot && snapshot.session.status === "live" && !didInit.current) {
      didInit.current = true;
      navigate(`/session/${sessionId}/host`, { replace: true });
    }
  }, [snapshot, sessionId, navigate]);

  const roster = (snapshot?.roster ?? []).filter((p) => p.status !== "left");
  const format = snapshot?.session.format ?? "";
  const isTeamSparring = format === "team_sparring";
  const isFixedPartner = (snapshot?.session.fixedPartnerStyle ?? null) !== null;
  // Score-independent formats pre-generate a whole schedule → they need a round count.
  const needsRoundCount = format === "americano" || format === "team_sparring" || format === "mix_americano" || snapshot?.session.fixedPartnerStyle === "round_robin";
  const hostName = ((user?.user_metadata?.name as string | undefined)?.trim() || (user?.email ?? "").split("@")[0] || "Me").trim();
  const hostAlreadyIn = roster.some((p) => p.name.trim().toLowerCase() === hostName.toLowerCase());
  const enoughPlayers = roster.length >= 4;

  async function handleConfirm(request: JoinRequest) {
    if (!sessionId) return;
    setBusyId(request.id);
    setError(null);
    try {
      await confirmJoinRequest(sessionId, request);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that player.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    setBusyId(id);
    try {
      await rejectJoinRequest(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decline.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemovePlayer(id: string) {
    setBusyId(id);
    try {
      await removePlayer(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove player.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddMe() {
    if (!sessionId) return;
    setBusyId("__me");
    setError(null);
    try {
      await addLatePlayer({ sessionId, name: hostName, gender: "M", teamSide: isTeamSparring ? "A" : undefined });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add you.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopyLink() {
    const link = `${window.location.origin}/join?code=${snapshot?.session.joinCode ?? ""}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      /* clipboard unavailable — code is shown as fallback */
    }
  }

  async function handleStart() {
    if (!sessionId || !enoughPlayers) return;
    setStarting(true);
    setError(null);
    try {
      await startSession(sessionId, roundCount);
      navigate(`/session/${sessionId}/host`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the session.");
      setStarting(false);
    }
  }

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
        <p className="text-sm text-warm-gray">{error ?? "Loading lobby…"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 safe-top safe-bottom anim-fade pb-28">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <Link to="/" aria-label="Home" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">
          ‹
        </Link>
        <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
        <div className="w-9" />
      </div>

      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">Lobby</p>
      <h1 className="font-serif text-[26px] font-medium tracking-tight text-graphite leading-[1.1] truncate">{snapshot.session.name}</h1>
      <p className="text-[12.5px] text-warm-gray mb-5">{FORMAT_LABELS[format] ?? format} · waiting to start</p>

      {/* Invite */}
      <div className="rounded-2xl border border-line bg-surface p-3.5 mb-5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Join code</p>
            <p className="font-mono tnum text-[28px] font-semibold text-graphite leading-tight tracking-[0.12em]">{snapshot.session.joinCode}</p>
          </div>
          <button onClick={handleCopyLink} className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3.5 py-2 active:scale-95 transition-transform">
            {copiedLink ? "Copied ✓" : "Copy link"}
          </button>
        </div>
        <p className="text-[11px] text-warm-gray mt-2 leading-snug">Players enter this code (or open your link) to ask to join — confirm them below. Scannable QR is coming next.</p>
      </div>

      {error && <p className="text-[13px] text-loss mb-3">{error}</p>}

      {/* Pending requests */}
      {joinRequests.length > 0 && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Asking to join</p>
          <div className="space-y-2 mb-5">
            {joinRequests.map((r) => (
              <div key={r.id} className="rounded-2xl border border-gold/40 bg-gold-soft/50 px-3.5 py-2.5 anim-rise">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <b className="block text-[14px] font-semibold text-graphite truncate">{r.displayName}</b>
                    <p className="text-[11px] text-ink-2 mt-0.5">
                      {r.preferredSide === "L" ? "Left" : r.preferredSide === "R" ? "Right" : "Any side"} · {r.gender === "F" ? "Female" : "Male"}
                      {r.email ? ` · ${r.email}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => handleReject(r.id)} disabled={busyId === r.id} className="text-[12px] font-semibold text-ink-2 rounded-full border border-line bg-surface px-3 py-1.5 disabled:opacity-50">
                      Decline
                    </button>
                    <button onClick={() => handleConfirm(r)} disabled={busyId === r.id} className="text-[12px] font-semibold text-ivory rounded-full bg-graphite px-3 py-1.5 disabled:opacity-50">
                      {busyId === r.id ? "…" : "Add"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Roster */}
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">In the session · {roster.length}</p>
        {!hostAlreadyIn && (
          <button onClick={handleAddMe} disabled={busyId === "__me"} className="text-[11.5px] font-semibold text-graphite rounded-full border border-graphite px-3 py-1 active:scale-95 transition-transform disabled:opacity-50">
            {busyId === "__me" ? "…" : "+ I'm playing too"}
          </button>
        )}
      </div>
      {roster.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-6 text-center mb-5">
          <p className="text-[13px] text-warm-gray">No players yet — share the code or add yourself.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-5">
          {roster.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 px-4 py-2.5 border-t border-line first:border-t-0">
              <span className="w-6 h-6 rounded-full bg-surface-2 border border-line text-ink-2 flex items-center justify-center text-[10px] font-semibold shrink-0">
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 text-[14px] font-semibold text-graphite truncate">{p.name}</span>
              {isTeamSparring && p.teamSide && (
                <span className={`text-[9px] font-bold rounded px-1 py-0.5 ${p.teamSide === "A" ? "bg-graphite text-ivory" : "bg-gold-soft text-gold-ink border border-gold/30"}`}>{p.teamSide}</span>
              )}
              <button onClick={() => handleRemovePlayer(p.id)} disabled={busyId === p.id} className="shrink-0 w-6 h-6 rounded-full text-warm-gray hover:text-loss flex items-center justify-center text-[15px] disabled:opacity-50" aria-label={`Remove ${p.name}`}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {(isTeamSparring || isFixedPartner) && (
        <p className="text-[11px] text-warm-gray -mt-3 mb-5 leading-snug">
          {isTeamSparring
            ? "Team Sparring: players who join by code start on Team A — adjust teams from Manage once you've started."
            : "Fixed Partner: pairs are set from your typed players — code joins aren't paired automatically yet."}
        </p>
      )}

      {/* Round count (schedule formats only) */}
      {needsRoundCount && (
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 mb-5">
          <div>
            <p className="text-[13px] font-semibold text-graphite">Rounds</p>
            <p className="text-[11px] text-warm-gray">How many rounds to schedule</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setRoundCount((n) => Math.max(1, n - 1))} className="w-8 h-8 rounded-full border border-line bg-surface text-ink-2 text-[18px] flex items-center justify-center active:scale-95">−</button>
            <span className="font-mono tnum text-[18px] font-semibold text-graphite w-6 text-center">{roundCount}</span>
            <button onClick={() => setRoundCount((n) => Math.min(30, n + 1))} className="w-8 h-8 rounded-full border border-line bg-surface text-ink-2 text-[18px] flex items-center justify-center active:scale-95">+</button>
          </div>
        </div>
      )}

      {/* Start bar — pinned to the bottom */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-5 pointer-events-none" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="w-full max-w-sm pointer-events-auto">
          <button
            onClick={handleStart}
            disabled={!enoughPlayers || starting}
            className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite shadow-[0_12px_30px_-10px_rgba(13,13,13,0.5)] active:scale-[0.99] transition-transform disabled:opacity-40"
          >
            {starting ? "Starting…" : enoughPlayers ? `Start with ${roster.length} player${roster.length === 1 ? "" : "s"}` : "Add at least 4 players to start"}
          </button>
        </div>
      </div>
    </div>
  );
}
