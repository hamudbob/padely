import { ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import {
  ActivityItem,
  AdminOverview,
  AdminSession,
  AdminUser,
  ErrorGroup,
  Growth,
  HealthCheck,
  LiveSession,
  SearchHit,
  AppSettings,
  adminSearch,
  getAdminAppSettings,
  getGrowth,
  getLiveNow,
  saveAppSettings,
  getAdminActivity,
  getAdminErrors,
  getAdminHealth,
  getAdminOverview,
  getAdminSessions,
  getAdminUsers,
  resolveErrorGroup,
} from "../../lib/supabase/adminQueries";
import { applySessionRatings } from "../../lib/supabase/ratingActions";
import { applySessionResults } from "../../lib/supabase/resultActions";
import { invalidateAppSettings } from "../../lib/supabase/appSettings";

/**
 * The operator's view of Padelier.
 *
 * This is the screen that answers "is anything wrong right now" without
 * anyone having to report it. The app's characteristic failure is silence —
 * RLS denies a read by returning an empty result, the end-of-session rating
 * write fails into a console nobody reads — so the most important tab here is
 * not Overview but HEALTH, which asks the database directly for the shapes
 * those failures leave behind.
 *
 * Layout note: every other screen in this app is `max-w-sm`, because it is a
 * phone app for people standing on a court. This one is `max-w-2xl`. It is
 * the one screen read at a desk with a lot of rows on it, and holding it to a
 * phone column would waste two thirds of the width for no reason. It still
 * has to work on a phone — hence the same type scale and touch targets.
 */

type Tab =
  | "overview"
  | "live"
  | "health"
  | "people"
  | "sessions"
  | "growth"
  | "errors"
  | "activity"
  | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "live", label: "Live" },
  { id: "health", label: "Health" },
  { id: "people", label: "People" },
  { id: "sessions", label: "Sessions" },
  { id: "growth", label: "Growth" },
  { id: "errors", label: "Errors" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

// ── Small shared pieces ──────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04)] ${className}`}>{children}</div>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: number | string; tone?: "plain" | "warn" }) {
  return (
    <Card className="px-3.5 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">{label}</p>
      <p
        className={`font-mono tnum text-[22px] font-semibold leading-none mt-1.5 ${
          tone === "warn" && Number(value) > 0 ? "text-loss" : "text-graphite"
        }`}
      >
        {value}
      </p>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-warm-gray px-1 py-6 text-center">{children}</p>;
}

/** Every tab loads the same way: fetch on mount, show the last good data
 *  while refetching, and say so plainly when it fails. */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load this.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: load };
}

function Loading({ error, loading, empty }: { error: string | null; loading: boolean; empty?: boolean }) {
  if (error) return <p className="text-[13px] text-loss px-1 py-6">{error}</p>;
  if (loading) return <p className="text-[13px] text-warm-gray px-1 py-6">Loading…</p>;
  if (empty) return <Empty>Nothing here.</Empty>;
  return null;
}

// ── Overview ─────────────────────────────────────────────────────────────

function Sparkline({ days }: { days: { day: string; sessions: number }[] }) {
  if (days.length === 0) return null;
  const max = Math.max(...days.map((d) => d.sessions), 1);
  return (
    <div className="flex items-end gap-[3px] h-[46px] mt-3" aria-hidden>
      {days.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.sessions}`}
          className="flex-1 rounded-t-[3px] bg-gold-soft"
          style={{ height: `${Math.max(3, (d.sessions / max) * 46)}px` }}
        />
      ))}
    </div>
  );
}

function OverviewTab() {
  const { data, error, loading } = useAsync<AdminOverview>(getAdminOverview, []);
  if (!data) return <Loading error={error} loading={loading} />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="People" value={data.users} />
        <Stat label="New / 7d" value={data.users_new_7d} />
        <Stat label="Active / 30d" value={data.users_active_30d} />
        <Stat label="Sessions" value={data.sessions_total} />
        <Stat label="Live now" value={data.sessions_live} />
        <Stat label="Sessions / 7d" value={data.sessions_7d} />
        <Stat label="Clubs" value={data.clubs} />
        <Stat label="Matches" value={data.matches_final} />
        <Stat label="Open errors" value={data.errors_open} tone="warn" />
      </div>

      <Card className="px-4 py-3.5">
        <p className="text-[13px] font-semibold text-ink-2">Sessions, last 21 days</p>
        <Sparkline days={data.daily} />
      </Card>

      <Card className="px-4 py-3.5">
        <p className="text-[13px] font-semibold text-ink-2 mb-2">Formats played</p>
        {data.formats.length === 0 ? (
          <Empty>No sessions yet.</Empty>
        ) : (
          <div className="space-y-1.5">
            {data.formats.map((f) => (
              <div key={f.format} className="flex items-center justify-between text-[13px]">
                <span className="text-graphite">{f.format}</span>
                <span className="font-mono tnum text-warm-gray">{f.n}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-[11px] text-warm-gray text-center">
        {data.admins} admin{data.admins === 1 ? "" : "s"} · {data.users_deleted} deleted account
        {data.users_deleted === 1 ? "" : "s"} · read {relativeTime(data.generated_at)}
      </p>
    </div>
  );
}

// ── Health ───────────────────────────────────────────────────────────────

/** The one repair worth putting on the health screen: an ended session whose
 *  rating or league write never landed can be re-run from here, because both
 *  RPCs are idempotent and 0041 lets an admin call them. */
function RefinalizeButton({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("working");
    setMessage(null);
    try {
      await applySessionRatings(sessionId);
      await applySessionResults(sessionId);
      setState("done");
    } catch (e) {
      setState("failed");
      setMessage(e instanceof Error ? e.message : "Could not finish that.");
    }
  }

  if (state === "done") return <span className="text-[12px] font-semibold text-win">Re-run ✓</span>;
  return (
    <span className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={state === "working"}
        className="text-[12px] font-semibold text-graphite border border-line rounded-full px-3 py-1.5 bg-ivory active:opacity-70 disabled:opacity-40"
      >
        {state === "working" ? "Working…" : "Re-run finalize"}
      </button>
      {message && <span className="text-[11px] text-loss">{message}</span>}
    </span>
  );
}

function HealthTab() {
  const { data, error, loading } = useAsync<HealthCheck[]>(getAdminHealth, []);
  if (!data) return <Loading error={error} loading={loading} />;

  const clean = data.every((c) => c.count === 0);
  return (
    <div className="space-y-3">
      {clean && (
        <Card className="px-4 py-4">
          <p className="text-[14px] font-semibold text-win">Everything checks out.</p>
          <p className="text-[12.5px] text-ink-2 mt-1">
            No unrated sessions, no ratings without history, no players stranded by a claim.
          </p>
        </Card>
      )}
      {data.map((check) => {
        const bad = check.count > 0;
        return (
          <Card key={check.key} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <p className={`text-[13.5px] font-semibold ${bad ? "text-graphite" : "text-warm-gray"}`}>
                {check.label}
              </p>
              <span
                className={`font-mono tnum text-[16px] font-semibold shrink-0 ${bad ? "text-loss" : "text-win"}`}
              >
                {check.count}
              </span>
            </div>
            {bad && (
              <>
                <p className="text-[12px] text-ink-2 mt-1.5 leading-relaxed">{check.why}</p>
                <div className="mt-2.5 space-y-1.5">
                  {check.sample.map((row, i) => {
                    const id = typeof row.id === "string" ? row.id : null;
                    const label =
                      (typeof row.name === "string" && row.name) ||
                      (typeof row.display_name === "string" && row.display_name) ||
                      id ||
                      "row";
                    const canRefinalize =
                      id !== null &&
                      (check.key === "sessions_unrated" || check.key === "sessions_results_missing");
                    return (
                      <div
                        key={id ?? i}
                        className="flex items-center justify-between gap-3 rounded-xl bg-ivory px-3 py-2"
                      >
                        <span className="text-[12.5px] text-graphite truncate">{label}</span>
                        {canRefinalize ? (
                          <RefinalizeButton sessionId={id} />
                        ) : (
                          <span className="text-[11px] font-mono text-warm-gray shrink-0">
                            {id ? id.slice(0, 8) : ""}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {check.count > check.sample.length && (
                    <p className="text-[11px] text-warm-gray px-1">
                      and {check.count - check.sample.length} more
                    </p>
                  )}
                </div>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── People ───────────────────────────────────────────────────────────────

function PeopleTab() {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const { data, error, loading } = useAsync<AdminUser[]>(() => getAdminUsers(applied), [applied]);

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or email"
          aria-label="Search people"
          className="flex-1 min-w-0 rounded-xl border border-line bg-ivory px-3 py-2.5 text-[16px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
        />
        <button className="shrink-0 rounded-xl bg-graphite text-ivory text-[13px] font-semibold px-4">Search</button>
      </form>

      {!data ? (
        <Loading error={error} loading={loading} />
      ) : data.length === 0 ? (
        <Empty>No accounts match that.</Empty>
      ) : (
        <Card className="overflow-hidden">
          {data.map((u) => (
            <Link
              key={u.id}
              to={`/admin/u/${u.id}`}
              className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors"
            >
              <span className="flex-1 min-w-0">
                <b className="block text-[14px] font-semibold text-graphite truncate">
                  {u.display_name}
                  {u.is_admin && <span className="ml-1.5 text-[11px] font-semibold text-gold-ink">admin</span>}
                  {u.deleted_at && <span className="ml-1.5 text-[11px] text-loss">deleted</span>}
                </b>
                <span className="block text-[11.5px] text-warm-gray truncate">
                  {u.email ?? "no email"} · {u.sessions_played} played · {u.sessions_hosted} hosted ·{" "}
                  {relativeTime(u.last_active)}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block font-mono tnum text-[14px] font-semibold text-graphite">
                  {Math.round(u.rating)}
                </span>
                <span className="block text-[11px] text-warm-gray">{u.rating_games} games</span>
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────

const STATUSES: { id: string | undefined; label: string }[] = [
  { id: undefined, label: "All" },
  { id: "live", label: "Live" },
  { id: "ended", label: "Ended" },
  { id: "draft", label: "Draft" },
];

function SessionsTab() {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const { data, error, loading } = useAsync<AdminSession[]>(() => getAdminSessions(status), [status]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s.label}
            onClick={() => setStatus(s.id)}
            className={`text-[12.5px] font-semibold rounded-full px-3 py-1.5 border ${
              status === s.id ? "bg-graphite text-ivory border-graphite" : "bg-surface text-ink-2 border-line"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {!data ? (
        <Loading error={error} loading={loading} />
      ) : data.length === 0 ? (
        <Empty>No sessions.</Empty>
      ) : (
        <Card className="overflow-hidden">
          {data.map((s) => {
            const needsFinalize = s.status === "ended" && (!s.ratings_applied || !s.results_applied);
            return (
              <div key={s.id} className="px-4 py-3 border-t border-line first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/admin/s/${s.id}`} className="min-w-0 active:opacity-70">
                    <b className="block text-[14px] font-semibold text-graphite truncate">{s.name}</b>
                    <span className="block text-[11.5px] text-warm-gray truncate">
                      {s.format} · {s.host_name ?? "unknown host"}
                      {s.club_name ? ` · ${s.club_name}` : ""} · {relativeTime(s.created_at)}
                    </span>
                  </Link>
                  <span className="text-[11px] font-semibold shrink-0 text-warm-gray uppercase tracking-[0.08em]">
                    {s.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11.5px] text-ink-2">
                  <span className="font-mono tnum">
                    {s.players} players ({s.accounts} accounts)
                  </span>
                  <span className="font-mono tnum">{s.rounds} rounds</span>
                  <span className="font-mono tnum">{s.final_matches} scored</span>
                  {s.status === "ended" && (
                    <>
                      <span className={s.ratings_applied ? "text-win" : "text-loss font-semibold"}>
                        {s.ratings_applied ? "rated" : "not rated"}
                      </span>
                      {s.club_name && (
                        <span className={s.results_applied ? "text-win" : "text-loss font-semibold"}>
                          {s.results_applied ? "in league" : "missing from league"}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {needsFinalize && (
                  <div className="mt-2">
                    <RefinalizeButton sessionId={s.id} />
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// ── Errors ───────────────────────────────────────────────────────────────

function ErrorsTab() {
  const [includeResolved, setIncludeResolved] = useState(false);
  const { data, error, loading, reload } = useAsync<ErrorGroup[]>(
    () => getAdminErrors(168, includeResolved),
    [includeResolved],
  );
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  async function resolve(fingerprint: string) {
    try {
      await resolveErrorGroup(fingerprint, true);
      reload();
    } catch {
      /* the list simply won't change — nothing to recover from here */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-warm-gray">Last 7 days, grouped.</p>
        <button
          onClick={() => setIncludeResolved((v) => !v)}
          className="text-[12px] font-semibold text-ink-2 border border-line rounded-full px-3 py-1.5 bg-surface active:opacity-70"
        >
          {includeResolved ? "Hide resolved" : "Show resolved"}
        </button>
      </div>

      {!data ? (
        <Loading error={error} loading={loading} />
      ) : data.length === 0 ? (
        <Empty>No errors reported. That is either very good or very suspicious.</Empty>
      ) : (
        data.map((g) => (
          <Card key={g.fingerprint} className="px-4 py-3.5">
            <button
              onClick={() => setOpenGroup(openGroup === g.fingerprint ? null : g.fingerprint)}
              className="w-full text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <b className="text-[13.5px] font-semibold text-graphite break-words">{g.message}</b>
                <span className="font-mono tnum text-[14px] font-semibold text-loss shrink-0">{g.occurrences}</span>
              </div>
              <p className="text-[11.5px] text-warm-gray mt-1">
                {g.kind} · {g.route ?? "no route"} · {g.users} user{g.users === 1 ? "" : "s"} ·{" "}
                {relativeTime(g.last_seen)}
                {g.app_version ? ` · ${g.app_version}` : ""}
                {!g.open ? " · resolved" : ""}
              </p>
            </button>

            {openGroup === g.fingerprint && (
              <>
                {g.stack && (
                  <pre className="mt-2.5 text-[10.5px] leading-[1.5] text-ink-2 bg-ivory rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words">
                    {g.stack}
                  </pre>
                )}
                {g.open && (
                  <button
                    onClick={() => resolve(g.fingerprint)}
                    className="mt-2.5 text-[12px] font-semibold text-graphite border border-line rounded-full px-3 py-1.5 bg-ivory active:opacity-70"
                  >
                    Mark resolved
                  </button>
                )}
              </>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────

const ACTIVITY_LABEL: Record<ActivityItem["kind"], string> = {
  session_created: "Session created",
  session_ended: "Session ended",
  account_created: "New account",
  club_created: "Club created",
  club_joined: "Joined a club",
  score_edited: "Score edited",
  claim: "Spot claimed",
  error: "Error",
  admin_action: "Admin action",
};

function detailLine(item: ActivityItem): string {
  const d = item.detail ?? {};
  const parts: string[] = [];
  for (const key of ["name", "who", "message", "action", "role", "status", "format", "route", "from", "to", "reason"]) {
    const value = d[key];
    if (value === null || value === undefined || value === "") continue;
    parts.push(key === "from" ? `${String(value)} →` : String(value));
  }
  return parts.join(" · ");
}

function ActivityTab() {
  const { data, error, loading } = useAsync<ActivityItem[]>(() => getAdminActivity(80), []);
  if (!data) return <Loading error={error} loading={loading} />;
  if (data.length === 0) return <Empty>Nothing has happened yet.</Empty>;

  return (
    <Card className="overflow-hidden">
      {data.map((item, i) => (
        <div key={`${item.kind}-${item.at}-${i}`} className="px-4 py-2.5 border-t border-line first:border-t-0">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={`text-[12px] font-semibold ${
                item.kind === "error" ? "text-loss" : item.kind === "admin_action" ? "text-gold-ink" : "text-ink-2"
              }`}
            >
              {ACTIVITY_LABEL[item.kind]}
            </span>
            <span className="text-[11px] text-warm-gray shrink-0">{relativeTime(item.at)}</span>
          </div>
          <p className="text-[12.5px] text-graphite truncate">{detailLine(item)}</p>
        </div>
      ))}
    </Card>
  );
}


// ── Search ───────────────────────────────────────────────────────────────

/**
 * One box, anything in it: a join code, a public token, a uuid, an email, a
 * name. Support conversations don't arrive sorted by entity type — "the code
 * is ABC123" and "his email is x@y" are the same question — so neither does
 * this.
 */
function SearchBox() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      setHits(await adminSearch(query));
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  const href = (h: SearchHit) =>
    h.type === "user" ? `/admin/u/${h.id}` : `/admin/s/${h.id}`;

  return (
    <div className="mb-4">
      <form onSubmit={run} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Code, email, name, or id"
          aria-label="Search everything"
          className="flex-1 min-w-0 rounded-xl border border-line bg-ivory px-3 py-2.5 text-[16px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
        />
        <button className="shrink-0 rounded-xl bg-graphite text-ivory text-[13px] font-semibold px-4">
          {busy ? "…" : "Find"}
        </button>
        {hits !== null && (
          <button
            type="button"
            onClick={() => {
              setHits(null);
              setQuery("");
            }}
            className="shrink-0 rounded-xl border border-line text-ink-2 text-[13px] font-semibold px-3 bg-surface"
          >
            Clear
          </button>
        )}
      </form>

      {hits !== null && (
        <Card className="overflow-hidden mt-2">
          {hits.length === 0 ? (
            <Empty>Nothing matches that.</Empty>
          ) : (
            hits.map((h) => (
              <Link
                key={`${h.type}-${h.id}-${h.label}`}
                to={href(h)}
                className="flex items-center gap-3 px-4 py-2.5 border-t border-line first:border-t-0 active:bg-surface-2"
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-gray w-[52px] shrink-0">
                  {h.type}
                </span>
                <span className="min-w-0">
                  <b className="block text-[13px] font-semibold text-graphite truncate">{h.label}</b>
                  <span className="block text-[11.5px] text-warm-gray truncate">{h.sublabel}</span>
                </span>
              </Link>
            ))
          )}
        </Card>
      )}
    </div>
  );
}

// ── Live now ─────────────────────────────────────────────────────────────

function LiveTab() {
  const { data, error, loading, reload } = useAsync<LiveSession[]>(getLiveNow, []);
  // A live screen that doesn't move is a lie. Cheap enough: one small RPC.
  useEffect(() => {
    const id = window.setInterval(reload, 30_000);
    return () => window.clearInterval(id);
  }, [reload]);

  if (!data) return <Loading error={error} loading={loading} />;
  if (data.length === 0) return <Empty>Nothing is live right now.</Empty>;

  return (
    <div className="space-y-2">
      {data.map((s) => {
        const idleMinutes = Math.round((Date.now() - new Date(s.last_activity).getTime()) / 60000);
        const stale = idleMinutes > 30;
        return (
          <Card key={s.id} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <Link to={`/admin/s/${s.id}`} className="min-w-0 active:opacity-70">
                <b className="block text-[14px] font-semibold text-graphite truncate">{s.name}</b>
                <span className="block text-[11.5px] text-warm-gray truncate">
                  {s.format} · {s.host_name ?? "unknown host"}
                  {s.club_name ? ` · ${s.club_name}` : ""} · code {s.join_code}
                </span>
              </Link>
              <span className={`text-[11.5px] font-semibold shrink-0 ${stale ? "text-loss" : "text-win"}`}>
                {idleMinutes < 1 ? "just now" : `${idleMinutes}m idle`}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11.5px] text-ink-2 font-mono tnum">
              <span>{s.players} players</span>
              <span>round {s.current_round ?? "–"} of {s.rounds}</span>
              <span>{s.scored} scored</span>
              <span>{s.unscored} open</span>
            </div>
            {stale && (
              <p className="text-[11.5px] text-ink-2 mt-1.5 leading-relaxed">
                No score for {idleMinutes} minutes — either it finished and nobody pressed End, or the host lost
                the tab. Open it to see which.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Growth ───────────────────────────────────────────────────────────────

function Bar({ label, value, of }: { label: string; value: number; of: number }) {
  const pct = of === 0 ? 0 : Math.round((value / of) * 100);
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-graphite">{label}</span>
        <span className="font-mono tnum text-[12.5px] text-ink-2">
          {value} <span className="text-warm-gray">· {pct}%</span>
        </span>
      </div>
      <div className="h-[6px] rounded-full bg-surface-2 mt-1 overflow-hidden">
        <div className="h-full rounded-full bg-gold-soft" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GrowthTab() {
  const { data, error, loading } = useAsync<Growth>(getGrowth, []);
  if (!data) return <Loading error={error} loading={loading} />;
  const f = data.funnel;

  return (
    <div className="space-y-4">
      <Card className="px-4 py-3.5">
        <p className="text-[13px] font-semibold text-ink-2">Of everyone who signed up over a week ago</p>
        <p className="text-[11.5px] text-warm-gray mt-0.5 mb-2">
          Newer accounts are excluded — they haven’t had a fair chance to play yet, and counting them would flatter
          nobody.
        </p>
        <Bar label="Finished onboarding" value={f.onboarded} of={f.accounts} />
        <Bar label="Played at least once" value={f.played_ever} of={f.accounts} />
        <Bar label="Played within their first week" value={f.played_in_7d} of={f.accounts} />
        <Bar label="Came back for a second session" value={f.played_twice} of={f.accounts} />
        <Bar label="Hosted something themselves" value={f.hosted_ever} of={f.accounts} />
        <p className="text-[11.5px] text-warm-gray mt-2">{f.accounts} accounts counted.</p>
      </Card>

      <Card className="px-4 py-3.5">
        <p className="text-[13px] font-semibold text-ink-2 mb-2">Week by week</p>
        <div className="space-y-1">
          <div className="flex text-[10px] font-bold uppercase tracking-[0.1em] text-warm-gray">
            <span className="flex-1">Week</span>
            <span className="w-14 text-right">Signups</span>
            <span className="w-14 text-right">Sessions</span>
            <span className="w-14 text-right">Hosts</span>
            <span className="w-14 text-right">Players</span>
          </div>
          {data.weekly.map((w) => (
            <div key={w.week} className="flex text-[12px] font-mono tnum text-ink-2">
              <span className="flex-1 text-graphite">{w.week.slice(5)}</span>
              <span className="w-14 text-right">{w.signups}</span>
              <span className="w-14 text-right">{w.sessions}</span>
              <span className="w-14 text-right">{w.active_hosts}</span>
              <span className="w-14 text-right">{w.active_players}</span>
            </div>
          ))}
        </div>
      </Card>

      {data.stalled.length > 0 && (
        <Card className="px-4 py-3.5">
          <p className="text-[13px] font-semibold text-ink-2">Signed up, never played</p>
          <p className="text-[11.5px] text-warm-gray mt-0.5 mb-2">
            The list worth acting on: an account is here a week after signing up with no session to its name.
          </p>
          {data.stalled.map((u) => (
            <Link
              key={u.id}
              to={`/admin/u/${u.id}`}
              className="flex items-baseline justify-between gap-3 py-1.5 border-t border-line first:border-t-0 active:opacity-70"
            >
              <span className="text-[12.5px] text-graphite truncate">
                {u.display_name}
                {!u.onboarded && <span className="text-loss"> · never finished setup</span>}
              </span>
              <span className="text-[11.5px] text-warm-gray shrink-0">{relativeTime(u.created_at)}</span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────

/**
 * The switches the app reads on load. Worth being honest in the UI about
 * what each one really does — a pause on signups is enforced in the signup
 * form, not in the database, so it stops the ordinary route and not a
 * determined person with an API client.
 */
function SettingsTab() {
  const { data, error, loading, reload } = useAsync<AppSettings>(getAdminAppSettings, []);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (!draft) return <Loading error={error} loading={loading} />;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setNote(null);
    try {
      await saveAppSettings({
        banner_message: draft.banner_message?.trim() ? draft.banner_message.trim() : null,
        banner_tone: draft.banner_tone,
        banner_until: draft.banner_until,
        signups_paused: draft.signups_paused,
        maintenance_message: draft.maintenance_message?.trim() ? draft.maintenance_message.trim() : null,
      });
      invalidateAppSettings(); // so the banner updates without a reload
      setNote("Saved. It’s on every screen from the next page load.");
      reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn’t save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="px-4 py-3.5">
        <p className="text-[13px] font-semibold text-ink-2">Announcement banner</p>
        <p className="text-[11.5px] text-warm-gray mt-0.5 mb-2">
          Shown at the top of every screen, signed in or not, until someone dismisses it or it expires.
        </p>
        <textarea
          value={draft.banner_message ?? ""}
          onChange={(e) => setDraft({ ...draft, banner_message: e.target.value })}
          rows={2}
          placeholder="League resets on Sunday."
          className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[15px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
        />
        <div className="flex gap-2 mt-2">
          {(["info", "warn"] as const).map((tone) => (
            <button
              key={tone}
              onClick={() => setDraft({ ...draft, banner_tone: tone })}
              className={`text-[12.5px] font-semibold rounded-full px-3 py-1.5 border ${
                draft.banner_tone === tone ? "bg-graphite text-ivory border-graphite" : "bg-surface text-ink-2 border-line"
              }`}
            >
              {tone === "info" ? "Quiet" : "Attention"}
            </button>
          ))}
        </div>
        <label className="block text-[11.5px] text-warm-gray mt-3">
          Stops showing after (optional)
          <input
            type="datetime-local"
            value={draft.banner_until ? new Date(draft.banner_until).toISOString().slice(0, 16) : ""}
            onChange={(e) =>
              setDraft({ ...draft, banner_until: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
            className="block w-full mt-1 rounded-xl border border-line bg-ivory px-3 py-2 text-[15px] text-ink"
          />
        </label>
      </Card>

      <Card className="px-4 py-3.5">
        <p className="text-[13px] font-semibold text-ink-2">Maintenance note</p>
        <p className="text-[11.5px] text-warm-gray mt-0.5 mb-2">
          Takes over the banner and always reads as urgent. Nothing is blocked — people can still use the app, which
          is deliberate: a padel session in progress must not be interrupted by a notice.
        </p>
        <textarea
          value={draft.maintenance_message ?? ""}
          onChange={(e) => setDraft({ ...draft, maintenance_message: e.target.value })}
          rows={2}
          placeholder="Scores may be slow to sync for the next hour."
          className="w-full rounded-xl border border-line bg-ivory px-3 py-2.5 text-[15px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
        />
      </Card>

      <Card className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <span>
            <p className="text-[13px] font-semibold text-ink-2">Pause new signups</p>
            <p className="text-[11.5px] text-warm-gray mt-0.5">
              The sign-up form refuses and explains. Existing accounts are untouched. Enforced in the app, not the
              database — it closes the front door, it isn’t a lock.
            </p>
          </span>
          <button
            onClick={() => setDraft({ ...draft, signups_paused: !draft.signups_paused })}
            className={`shrink-0 text-[12.5px] font-semibold rounded-full px-3.5 py-2 border ${
              draft.signups_paused ? "bg-loss text-ivory border-loss" : "bg-surface text-ink-2 border-line"
            }`}
          >
            {draft.signups_paused ? "Paused" : "Open"}
          </button>
        </div>
      </Card>

      <button
        onClick={save}
        disabled={busy}
        className="w-full rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {note && <p className="text-[12px] text-ink-2 text-center">{note}</p>}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    // Wider than the rest of the app on purpose — see the note at the top.
    <div className="mx-auto w-full max-w-2xl min-h-screen bg-ivory px-4 py-6 safe-top safe-bottom anim-fade">
      <PageHeader fallback="/profile" />

      <h1 className="font-serif text-[26px] font-semibold text-graphite mt-5">Admin</h1>
      <p className="text-[12.5px] text-warm-gray mt-1">
        Everything the app knows about itself. Health first — it looks for the failures that don’t announce
        themselves.
      </p>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-4 mb-4 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 text-[13px] font-semibold rounded-full px-3.5 py-2 border transition-colors ${
              tab === t.id ? "bg-graphite text-ivory border-graphite" : "bg-surface text-ink-2 border-line"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <SearchBox />

      {tab === "overview" && <OverviewTab />}
      {tab === "live" && <LiveTab />}
      {tab === "health" && <HealthTab />}
      {tab === "people" && <PeopleTab />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "growth" && <GrowthTab />}
      {tab === "errors" && <ErrorsTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
