import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import {
  getMySessionClaim,
  getClaimablePlayers,
  requestPlayerClaim,
  ClaimTarget,
  MyClaim,
} from "../../lib/supabase/claimQueries";
import { requestJoin, lookupGuest } from "../../lib/supabase/playerJoinQueries";

/**
 * The "get in the game" panel on the live session view (0029 + unified entry).
 * Watching is open to anyone; this panel adds the two ways to actually take
 * part:
 *   • Claim your spot — link your account to a manual placeholder (account only).
 *   • Join as a new player — add yourself to the roster (account one-tap, or a
 *     short guest form for signed-out players).
 * Both create a request the host approves. `joinCode` is the 6-digit code the
 * viewer entered to get here (needed by request_join); when it's absent — e.g.
 * a bare /live/<token> spectator link — the "join as new" path is disabled.
 */
type Sub = "idle" | "claim" | "guest";

export default function SessionJoinPanel({ publicToken, joinCode }: { publicToken: string; joinCode: string | null }) {
  const { user } = useHostSession();
  const [mine, setMine] = useState<MyClaim | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sub, setSub] = useState<Sub>("idle");
  const [targets, setTargets] = useState<ClaimTarget[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<{ kind: "claim" | "join"; name: string } | null>(null);

  // Guest join-as-new form.
  const [gName, setGName] = useState("");
  const [gSide, setGSide] = useState<"L" | "R">("R");
  const [gGender, setGGender] = useState<"M" | "F">("M");
  const [gEmail, setGEmail] = useState("");

  const loadMine = useCallback(() => {
    if (!user) {
      setLoaded(true);
      return;
    }
    getMySessionClaim(publicToken)
      .then(setMine)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [user, publicToken]);

  useEffect(loadMine, [loadMine]);

  // Poll while a claim is pending so host acceptance flips to "joined" live.
  useEffect(() => {
    if (!user || mine?.status !== "pending") return;
    const t = window.setInterval(loadMine, 8000);
    return () => window.clearInterval(t);
  }, [user, mine?.status, loadMine]);

  async function openClaim() {
    setSub("claim");
    setErr(null);
    if (user && targets == null) {
      try {
        setTargets(await getClaimablePlayers(publicToken));
      } catch {
        setTargets([]);
      }
    }
  }

  async function doClaim(t: ClaimTarget) {
    setBusy(t.id);
    setErr(null);
    try {
      await requestPlayerClaim(t.id);
      setRequested({ kind: "claim", name: t.name });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't claim that spot — someone may have just taken it.");
      getClaimablePlayers(publicToken).then(setTargets).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function joinAsAccount() {
    if (!joinCode || !user) return;
    setBusy("acct");
    setErr(null);
    try {
      const md = user.user_metadata ?? {};
      const nm = (md.name as string | undefined)?.trim() || (user.email ?? "").split("@")[0] || "Player";
      let g: "M" | "F" = md.gender === "F" ? "F" : "M";
      let s: "L" | "R" = md.preferred_side === "L" ? "L" : "R";
      if (!md.gender || !md.preferred_side) {
        const guest = await lookupGuest(user.email ?? "").catch(() => null);
        if (guest) {
          if (!md.gender) g = guest.gender;
          if (!md.preferred_side && guest.preferredSide) s = guest.preferredSide;
        }
      }
      await requestJoin({ code: joinCode, name: nm, gender: g, preferredSide: s, email: user.email ?? null });
      setRequested({ kind: "join", name: nm });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't join just now — please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function submitGuest(e: FormEvent) {
    e.preventDefault();
    if (!joinCode || !gName.trim()) return;
    setBusy("guest");
    setErr(null);
    try {
      await requestJoin({ code: joinCode, name: gName.trim(), gender: gGender, preferredSide: gSide, email: gEmail.trim() || null });
      setRequested({ kind: "join", name: gName.trim() });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't join just now — please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return null;

  const card = "rounded-2xl border border-line bg-surface px-4 py-3.5 mb-5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]";
  const pill = "rounded-xl border border-line bg-surface px-3 py-2.5 text-[12.5px] font-semibold text-graphite active:scale-[0.97] transition-transform disabled:opacity-40";

  // Terminal states.
  if (mine?.status === "joined") {
    return (
      <div className={card}>
        <p className="text-[12.5px] text-ink-2">
          You're in as <span className="font-semibold text-graphite">{mine.playerName}</span>.
        </p>
      </div>
    );
  }
  if (requested) {
    return (
      <div className={card}>
        <p className="text-[12.5px] text-ink-2">
          {requested.kind === "claim" ? (
            <>
              Claim sent for <span className="font-semibold text-graphite">{requested.name}</span> — waiting for the host to accept.
            </>
          ) : (
            <>
              You're on the list as <span className="font-semibold text-graphite">{requested.name}</span> — waiting for the host to wave you in.
            </>
          )}
        </p>
      </div>
    );
  }
  if (mine?.status === "pending") {
    return (
      <div className={card}>
        <p className="text-[12.5px] text-ink-2">
          Claim sent for <span className="font-semibold text-graphite">{mine.playerName}</span> — waiting for the host to accept.
        </p>
      </div>
    );
  }

  return (
    <div className={card}>
      {sub === "idle" && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray">Get in the game</p>
          <div className="flex gap-2">
            <button onClick={openClaim} className={`flex-1 ${pill}`}>
              Claim your spot
            </button>
            <button
              onClick={() => (user ? joinAsAccount() : setSub("guest"))}
              disabled={busy === "acct" || !joinCode}
              className={`flex-1 ${pill}`}
            >
              {busy === "acct" ? "…" : "Join as new"}
            </button>
          </div>
          {!joinCode && <p className="text-[11px] text-warm-gray">Enter the session code from the home screen to join or claim a spot.</p>}
          {err && <p className="text-[11.5px] text-loss">{err}</p>}
        </div>
      )}

      {sub === "claim" && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray">Which one are you?</p>
            <button onClick={() => setSub("idle")} className="text-[11px] font-semibold text-warm-gray">Back</button>
          </div>
          {!user ? (
            <p className="text-[12.5px] text-ink-2">
              <Link to={`/login?next=${encodeURIComponent(`/live/${publicToken}`)}`} className="font-semibold text-gold-ink">
                Sign in
              </Link>{" "}
              to claim the spot that's yours.
            </p>
          ) : targets == null ? (
            <p className="text-[12px] text-warm-gray">Loading…</p>
          ) : targets.length === 0 ? (
            <p className="text-[12px] text-warm-gray">All spots are claimed — use “Join as new” instead.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {targets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => doClaim(t)}
                  disabled={busy === t.id}
                  className="rounded-full border border-line bg-gold-soft text-gold-ink px-3.5 py-1.5 text-[12.5px] font-semibold active:scale-95 transition-transform disabled:opacity-40"
                >
                  {busy === t.id ? "…" : t.name}
                </button>
              ))}
            </div>
          )}
          {err && <p className="text-[11.5px] text-loss mt-2">{err}</p>}
        </>
      )}

      {sub === "guest" && (
        <form onSubmit={submitGuest} className="space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray">Join as a new player</p>
            <button type="button" onClick={() => setSub("idle")} className="text-[11px] font-semibold text-warm-gray">Back</button>
          </div>
          <input
            value={gName}
            onChange={(e) => setGName(e.target.value)}
            maxLength={40}
            placeholder="Your name"
            className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
          />
          <div className="flex gap-2">
            <div className="flex-1 flex gap-1 rounded-xl border border-line bg-ivory p-1">
              {(["L", "R"] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setGSide(s)}
                  className={`flex-1 rounded-lg py-1.5 text-[12px] font-semibold ${gSide === s ? "bg-graphite text-ivory" : "text-ink-2"}`}
                >
                  {s === "L" ? "Left" : "Right"}
                </button>
              ))}
            </div>
            <div className="flex-1 flex gap-1 rounded-xl border border-line bg-ivory p-1">
              {(["M", "F"] as const).map((g) => (
                <button
                  type="button"
                  key={g}
                  onClick={() => setGGender(g)}
                  className={`flex-1 rounded-lg py-1.5 text-[12px] font-semibold ${gGender === g ? "bg-graphite text-ivory" : "text-ink-2"}`}
                >
                  {g === "M" ? "Male" : "Female"}
                </button>
              ))}
            </div>
          </div>
          <input
            value={gEmail}
            onChange={(e) => setGEmail(e.target.value)}
            type="email"
            placeholder="Email (optional)"
            className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
          />
          {err && <p className="text-[11.5px] text-loss">{err}</p>}
          <button type="submit" disabled={busy === "guest" || !gName.trim()} className="w-full rounded-xl bg-graphite text-ivory px-3 py-2.5 text-[12.5px] font-semibold active:scale-[0.97] transition-transform disabled:opacity-40">
            {busy === "guest" ? "Sending…" : "Ask to join"}
          </button>
        </form>
      )}
    </div>
  );
}
