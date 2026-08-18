import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import {
  AdminUserDetail,
  getAdminUserDetail,
  resetUserRating,
  setAdmin,
} from "../../lib/supabase/adminQueries";

/**
 * One account, and what the database actually holds about it.
 *
 * The DIAGNOSIS block is the reason this page exists. "My rating says 1324
 * over 7 games but my Player tab is empty" has two completely different
 * causes that look identical from the outside:
 *
 *   • linked players > 0 and confirmed join requests = 0
 *       → the sessions exist; get_player_sessions matches on the email of a
 *         CONFIRMED JOIN REQUEST, and a player who tapped "claim your spot"
 *         never files one. The rating is right, the list is blind.
 *
 *   • history rows = 0 while games > 0
 *       → the sessions are gone and the rating outlived them. profiles.rating
 *         is a snapshot; deleting every rated session can leave it stranded.
 *         "Reset rating" is the repair.
 *
 * Rather than make the operator remember that, the page reads the numbers and
 * says which one it is.
 */

function timeOf(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-line first:border-t-0">
      <span className="text-[12.5px] text-warm-gray">{label}</span>
      <span className="text-[13px] text-graphite font-mono tnum text-right break-all">{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h2 className="text-[13px] font-semibold text-ink-2 mb-2 px-0.5">{title}</h2>
      <div className="rounded-2xl bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">{children}</div>
    </div>
  );
}

/** Reads the diagnosis numbers and says, in a sentence, what they mean. */
function verdict(d: AdminUserDetail["diagnosis"], ratingGames: number): { tone: "ok" | "warn"; text: string } {
  // history_live, not history_rows. A row whose session was deleted keeps a
  // null session_id and is not evidence of anything — reading it as history
  // is exactly the bug 0042 fixed.
  if (ratingGames > 0 && d.history_live === 0) {
    const debris =
      d.history_orphaned > 0
        ? ` The ${d.history_orphaned} history row${d.history_orphaned === 1 ? "" : "s"} still here point at deleted sessions; reset clears them too.`
        : "";
    return {
      tone: "warn",
      text:
        "This rating has no surviving session behind it. Every rated session was deleted and the snapshot outlived them — the number corresponds to no game that still exists. Reset rating puts it back to a new player’s 1500." +
        debris,
    };
  }
  if (d.linked_player_rows > 0 && d.confirmed_join_requests === 0) {
    return {
      tone: "warn",
      text:
        "Their sessions exist and count toward their rating, but the Player tab can’t see them: it looks for a confirmed join request with this email, and a claimed spot never files one. Nothing here is corrupt — the list is querying the wrong way round.",
    };
  }
  if (d.history_orphaned > 0) {
    return {
      tone: "warn",
      text: `${d.history_orphaned} rating-history row${d.history_orphaned === 1 ? "" : "s"} point at a session that no longer exists, so the trend line has a bump nothing explains. Reset rating removes them and rebuilds from what's left.`,
    };
  }
  return { tone: "ok", text: "Nothing inconsistent. Rating, history and sessions all agree." };
}

export default function AdminUserPage() {
  const { userId } = useParams();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!userId) return;
    getAdminUserDetail(userId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load that account."));
  }, [userId]);

  useEffect(load, [load]);

  async function doReset() {
    if (!userId) return;
    // Native confirm on purpose: this changes a number people care about, and
    // it should be as hard to do by accident as deleting something.
    if (!window.confirm("Recompute this rating from what the database still holds?")) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await resetUserRating(userId);
      const cleared =
        result.orphans_removed > 0
          ? ` Removed ${result.orphans_removed} history row${result.orphans_removed === 1 ? "" : "s"} whose session no longer exists (kept in the admin log).`
          : "";
      setNote(
        (result.mode === "defaults"
          ? `Reset to 1500 over 0 games — no session with a surviving record left to rebuild from.`
          : `Restored to ${Math.round(result.rating)} over ${result.games} games from the last snapshot whose session still exists.`) + cleared,
      );
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin(next: boolean) {
    if (!userId) return;
    if (!window.confirm(next ? "Make this account an admin?" : "Remove admin from this account?")) return;
    setBusy(true);
    setNote(null);
    try {
      await setAdmin(userId, next);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-2xl min-h-screen bg-ivory px-4 py-6 safe-top">
        <PageHeader fallback="/admin" />
        <p className="text-[13px] text-loss mt-6">{error}</p>
      </div>
    );
  }
  if (!data || !data.profile) {
    return (
      <div className="mx-auto w-full max-w-2xl min-h-screen bg-ivory px-4 py-6 safe-top">
        <PageHeader fallback="/admin" />
        <p className="text-[13px] text-warm-gray mt-6">Loading…</p>
      </div>
    );
  }

  const p = data.profile;
  const v = verdict(data.diagnosis, p.rating_games);

  return (
    <div className="mx-auto w-full max-w-2xl min-h-screen bg-ivory px-4 py-6 safe-top safe-bottom anim-fade">
      <PageHeader fallback="/admin" />

      <h1 className="font-serif text-[24px] font-semibold text-graphite mt-5">
        {p.display_name}
        {p.is_admin && <span className="ml-2 text-[12px] font-semibold text-gold-ink align-middle">admin</span>}
      </h1>
      <p className="text-[12.5px] text-warm-gray mt-0.5 break-all">
        {p.email ?? "no email"} · joined {timeOf(p.created_at)}
        {p.deleted_at ? ` · deleted ${timeOf(p.deleted_at)}` : ""}
      </p>

      {/* The verdict, before any of the raw numbers. */}
      <div
        className={`mt-4 rounded-2xl px-4 py-3.5 ${
          v.tone === "warn" ? "bg-gold-soft" : "bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04)]"
        }`}
      >
        <p className={`text-[13px] leading-relaxed ${v.tone === "warn" ? "text-gold-ink" : "text-ink-2"}`}>{v.text}</p>
      </div>

      <Section title="Rating">
        <Row label="Rating" value={Math.round(p.rating)} />
        <Row label="Deviation" value={Math.round(p.rating_deviation)} />
        <Row label="Volatility" value={p.rating_volatility} />
        <Row label="Games counted" value={p.rating_games} />
        <Row label="History rows (session still exists)" value={data.diagnosis.history_live} />
        <Row label="History rows (session deleted)" value={data.diagnosis.history_orphaned} />
        <div className="pt-3">
          <button
            onClick={doReset}
            disabled={busy}
            className="text-[12.5px] font-semibold text-graphite border border-line rounded-full px-3.5 py-2 bg-ivory active:opacity-70 disabled:opacity-40"
          >
            Reset rating
          </button>
          {note && <p className="text-[12px] text-ink-2 mt-2 leading-relaxed">{note}</p>}
        </div>
      </Section>

      <Section title="Why the tabs look the way they do">
        <Row label="Player rows linked to this account" value={data.diagnosis.linked_player_rows} />
        <Row label="Confirmed join requests by email" value={data.diagnosis.confirmed_join_requests} />
        <Row label="Sessions hosted" value={data.diagnosis.sessions_hosted} />
        <Row label="League result rows" value={data.diagnosis.league_rows} />
        <Row label="Orphaned history rows" value={data.diagnosis.history_orphaned} />
      </Section>

      <Section title={`Sessions (${data.sessions.length})`}>
        {data.sessions.length === 0 ? (
          <p className="text-[12.5px] text-warm-gray py-2">None.</p>
        ) : (
          data.sessions.map((s) => (
            <div key={s.id} className="py-2 border-t border-line first:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <b className="text-[13px] font-semibold text-graphite truncate">{s.name}</b>
                <span className="text-[11px] text-warm-gray shrink-0">{s.hosted ? "hosted" : "played"}</span>
              </div>
              <p className="text-[11.5px] text-warm-gray">
                {s.format} · {s.status} · {timeOf(s.created_at)}
                {s.status === "ended" && !s.ratings_applied ? " · not rated" : ""}
              </p>
            </div>
          ))
        )}
      </Section>

      <Section title={`Rating history (${data.rating_history.length})`}>
        {data.rating_history.length === 0 ? (
          <p className="text-[12.5px] text-warm-gray py-2">
            None — which is why the rating above can’t be rebuilt from anything.
          </p>
        ) : (
          data.rating_history.map((h) => (
            <div key={h.id} className="flex items-baseline justify-between gap-3 py-1.5 border-t border-line first:border-t-0">
              <span className="text-[12.5px] text-graphite truncate">
                {h.session_name ?? <span className="text-loss">deleted session</span>}
              </span>
              <span className="font-mono tnum text-[12.5px] text-ink-2 shrink-0">
                {Math.round(h.rating)}{" "}
                <span className={Number(h.delta) >= 0 ? "text-win" : "text-loss"}>
                  {Number(h.delta) >= 0 ? "+" : ""}
                  {Math.round(Number(h.delta ?? 0))}
                </span>
              </span>
            </div>
          ))
        )}
      </Section>

      {data.clubs.length > 0 && (
        <Section title="Clubs">
          {data.clubs.map((c) => (
            <Row key={c.id} label={c.name} value={c.role} />
          ))}
        </Section>
      )}

      {data.errors.length > 0 && (
        <Section title="Recent errors from this account">
          {data.errors.map((e) => (
            <div key={e.id} className="py-1.5 border-t border-line first:border-t-0">
              <p className="text-[12.5px] text-graphite break-words">{e.message}</p>
              <p className="text-[11px] text-warm-gray">
                {e.route ?? "no route"} · {timeOf(e.created_at)}
              </p>
            </div>
          ))}
        </Section>
      )}

      {data.admin_actions.length > 0 && (
        <Section title="What admins have changed here">
          {data.admin_actions.map((a, i) => (
            <Row key={i} label={a.action} value={timeOf(a.created_at)} />
          ))}
        </Section>
      )}

      <Section title="Access">
        <button
          onClick={() => toggleAdmin(!p.is_admin)}
          disabled={busy}
          className="text-[12.5px] font-semibold text-graphite border border-line rounded-full px-3.5 py-2 bg-ivory active:opacity-70 disabled:opacity-40"
        >
          {p.is_admin ? "Remove admin" : "Make admin"}
        </button>
      </Section>

      <Link to="/admin" className="block text-center text-[12.5px] font-semibold text-warm-gray mt-6 active:opacity-70">
        ‹ All accounts
      </Link>
    </div>
  );
}
