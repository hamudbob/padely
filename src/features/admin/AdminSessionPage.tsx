import { ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import {
  SessionDetail,
  SearchHit,
  adminSearch,
  creditSessionRating,
  forceEndSession,
  getSessionDetail,
  linkPlayer,
} from "../../lib/supabase/adminQueries";
import { previewSessionCredit } from "../../lib/supabase/adminRatingRepair";
import { applySessionRatings } from "../../lib/supabase/ratingActions";
import { applySessionResults } from "../../lib/supabase/resultActions";

/**
 * One session, all the way down.
 *
 * This is the screen every support message needs. "The session is stuck",
 * "my games didn't count", "it says I wasn't there" — each of those is a
 * question about one session's players, its rounds, and whether its two
 * end-of-session writes actually landed. Reading that used to mean SQL.
 *
 * The two things worth looking at first are called out at the top rather
 * than buried: whether the ratings and league rows were written, and whether
 * each linked player has the confirmed join request that `get_player_sessions`
 * insists on. A player with `has_join_request: false` is counted in the
 * rating and invisible in their own Player tab — the single most confusing
 * state this app can produce, and now a line of text.
 */

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <h2 className="text-[13px] font-semibold text-ink-2 px-0.5">{title}</h2>
      {note && <p className="text-[11.5px] text-warm-gray px-0.5 mt-0.5 mb-2 leading-relaxed">{note}</p>}
      <div className={`rounded-2xl bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)] ${note ? "" : "mt-2"}`}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-line first:border-t-0">
      <span className="text-[12.5px] text-warm-gray shrink-0">{label}</span>
      <span className="text-[12.5px] text-graphite text-right break-all">{value}</span>
    </div>
  );
}

export default function AdminSessionPage() {
  const { sessionId } = useParams();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!sessionId) return;
    getSessionDetail(sessionId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load that session."));
  }, [sessionId]);

  useEffect(load, [load]);

  async function refinalize() {
    if (!sessionId) return;
    setBusy(true);
    setNote(null);
    try {
      await applySessionRatings(sessionId);
      await applySessionResults(sessionId);
      setNote("Finalize re-run. Both writes are idempotent, so pressing it again changes nothing.");
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  async function endIt() {
    if (!sessionId) return;
    if (!window.confirm("End this session now? It stays ended — this doesn’t apply ratings.")) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await forceEndSession(sessionId);
      setNote(r.changed ? "Ended. Re-run finalize if it should count." : "It was already ended.");
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  // ── Claiming a spot after the session ended ──────────────────────────
  // Someone played all night under a name the host typed in and only realised
  // afterwards that they never claimed it. Reopening the session is the
  // obvious fix and the wrong one — see migration 0047. Instead: link the row
  // to the account here, then credit that one account for that one session.
  const [linkFor, setLinkFor] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const found = await adminSearch(query.trim());
      setHits(found.filter((h) => h.type === "user"));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function link(playerId: string, userId: string, who: string) {
    setBusy(true);
    setNote(null);
    try {
      await linkPlayer(playerId, userId);
      setLinkFor(null);
      setQuery("");
      setHits(null);
      setNote(`Linked to ${who}. If the session is already rated, credit their rating below.`);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  async function credit(userId: string, name: string) {
    setBusy(true);
    setNote(null);
    try {
      const preview = await previewSessionCredit(sessionId!, userId);
      const move = `${preview.delta >= 0 ? "+" : ""}${preview.delta.toFixed(1)}`;
      const ok = window.confirm(
        `Credit ${name} for this session?\n\n` +
          `${preview.gamesInSession} game${preview.gamesInSession === 1 ? "" : "s"}: ` +
          `${Math.round(preview.ratingBefore)} → ${Math.round(preview.rating)} (${move})\n\n` +
          `Their opponents are valued at what they were worth on the night. ` +
          `The move applies to their rating as it stands today — it is not back-dated, ` +
          `and nobody else's rating changes.`,
      );
      if (!ok) return;
      const r = await creditSessionRating(sessionId!, userId, preview);
      setNote(`${name}: ${Math.round(r.rating_before)} → ${Math.round(r.rating_after)}.`);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(playerId: string, name: string) {
    if (!window.confirm(`Unlink ${name} from their account? Their rating for this session stays as it is.`)) return;
    setBusy(true);
    setNote(null);
    try {
      await linkPlayer(playerId, null);
      setNote(`${name} is no longer linked to an account.`);
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
  if (!data || !data.session) {
    return (
      <div className="mx-auto w-full max-w-2xl min-h-screen bg-ivory px-4 py-6 safe-top">
        <PageHeader fallback="/admin" />
        <p className="text-[13px] text-warm-gray mt-6">Loading…</p>
      </div>
    );
  }

  const s = data.session;
  const ended = s.status === "ended";
  const strandedPlayers = data.players.filter((p) => p.linked_user_id && !p.has_join_request);
  const finalizeMissing = ended && (!s.ratings_applied || (s.club_id !== null && !s.results_applied));

  return (
    <div className="mx-auto w-full max-w-2xl min-h-screen bg-ivory px-4 py-6 safe-top safe-bottom anim-fade">
      <PageHeader fallback="/admin" />

      <h1 className="font-serif text-[24px] font-semibold text-graphite mt-5 leading-tight">{s.name}</h1>
      <p className="text-[12.5px] text-warm-gray mt-0.5">
        {s.format} · {s.scoring_format} · {s.status} · hosted by {s.host_name ?? "unknown"}
        {s.club_name ? ` · ${s.club_name}` : ""}
      </p>

      {/* What went wrong, if anything, before any of the raw data. */}
      {(finalizeMissing || strandedPlayers.length > 0) && (
        <div className="mt-4 rounded-2xl bg-gold-soft px-4 py-3.5 space-y-2">
          {finalizeMissing && (
            <p className="text-[13px] text-gold-ink leading-relaxed">
              This session ended without writing {!s.ratings_applied ? "its ratings" : ""}
              {!s.ratings_applied && s.club_id !== null && !s.results_applied ? " or " : ""}
              {s.club_id !== null && !s.results_applied ? "its league rows" : ""}. That write is best-effort and
              isn’t retried, so it fails silently. Re-run finalize below.
            </p>
          )}
          {strandedPlayers.length > 0 && (
            <p className="text-[13px] text-gold-ink leading-relaxed">
              {strandedPlayers.length} player{strandedPlayers.length === 1 ? " is" : "s are"} linked to an account
              with no confirmed join request ({strandedPlayers.map((p) => p.display_name).join(", ")}). Their games
              count toward their rating, but this session will not appear in their Player tab.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {ended && (
          <button
            onClick={refinalize}
            disabled={busy}
            className="text-[12.5px] font-semibold text-graphite border border-line rounded-full px-3.5 py-2 bg-surface active:opacity-70 disabled:opacity-40"
          >
            Re-run finalize
          </button>
        )}
        {!ended && (
          <button
            onClick={endIt}
            disabled={busy}
            className="text-[12.5px] font-semibold text-loss border border-line rounded-full px-3.5 py-2 bg-surface active:opacity-70 disabled:opacity-40"
          >
            Force end
          </button>
        )}
        <a
          href={`/live/${s.public_token}`}
          target="_blank"
          rel="noreferrer"
          className="text-[12.5px] font-semibold text-ink-2 border border-line rounded-full px-3.5 py-2 bg-surface active:opacity-70"
        >
          Open live view ↗
        </a>
      </div>
      {note && <p className="text-[12px] text-ink-2 mt-2 leading-relaxed">{note}</p>}

      <Section title="The session">
        <Row label="Join code" value={<span className="font-mono">{s.join_code}</span>} />
        <Row label="Public token" value={<span className="font-mono text-[11px]">{s.public_token}</span>} />
        <Row label="Created" value={when(s.created_at)} />
        <Row label="Started" value={when(s.started_at)} />
        <Row label="Ended" value={when(s.ended_at)} />
        <Row label="Counts for league" value={s.counts_for_league === false ? "no" : "yes"} />
        <Row
          label="Ratings applied"
          value={<span className={s.ratings_applied ? "text-win" : "text-loss font-semibold"}>{s.ratings_applied ? "yes" : "no"}</span>}
        />
        <Row
          label="League rows written"
          value={
            s.club_id === null ? (
              "not a club session"
            ) : (
              <span className={s.results_applied ? "text-win" : "text-loss font-semibold"}>
                {s.results_applied ? "yes" : "no"}
              </span>
            )
          }
        />
        <Row label="Host" value={s.host_email ?? s.host_name ?? "—"} />
      </Section>

      <Section
        title={`Players (${data.players.length})`}
        note="“no join request” means this session is invisible in that person’s Player tab, however correct their rating is."
      >
        {data.players.map((p) => (
          <div key={p.id} className="py-2 border-t border-line first:border-t-0">
            <div className="flex items-baseline justify-between gap-3">
              <b className="text-[13px] font-semibold text-graphite truncate">
                {p.display_name}
                {p.gender ? <span className="text-warm-gray font-normal"> · {p.gender}</span> : null}
              </b>
              <span className="text-[11px] text-warm-gray shrink-0 font-mono tnum">
                {p.matches_played} played · {p.rests} rests
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-0.5">
              <span className="text-[11.5px] truncate">
                {p.linked_user_id ? (
                  <>
                    <span className="text-ink-2">{p.account_email ?? p.account_name}</span>
                    {!p.has_join_request && <span className="text-loss font-semibold"> · no join request</span>}
                  </>
                ) : (
                  <span className="text-warm-gray">guest{p.email ? ` · ${p.email}` : ""}</span>
                )}
              </span>
              {p.linked_user_id ? (
                <span className="flex items-center gap-2 shrink-0">
                  <Link to={`/admin/u/${p.linked_user_id}`} className="text-[11.5px] font-semibold text-gold-ink">
                    account ›
                  </Link>
                  {/* Only worth offering once the session is over and its
                      ratings have run — before that, ending it normally rates
                      everyone including this person. The RPC refuses a second
                      credit, so a double tap is safe. */}
                  {/* Only for someone this session HASN'T counted for. Ending a
                      session rates everyone in it, so before 0049 this button
                      appeared on nearly every row and could only fail — the
                      database was doing the thinking the interface should have
                      done. */}
                  {ended && s.ratings_applied && p.rated_for_session && (
                    <span className="text-[11px] text-warm-gray">rating counted ✓</span>
                  )}
                  {ended && s.ratings_applied && !p.rated_for_session && (
                    <button
                      onClick={() => credit(p.linked_user_id!, p.display_name)}
                      disabled={busy}
                      className="text-[11.5px] font-semibold text-gold-ink border border-gold/40 rounded-full px-2.5 py-1 bg-gold-soft active:opacity-70 disabled:opacity-40"
                    >
                      Credit rating
                    </button>
                  )}
                  <button
                    onClick={() => unlink(p.id, p.display_name)}
                    disabled={busy}
                    className="text-[11.5px] font-semibold text-warm-gray border border-line rounded-full px-2.5 py-1 bg-ivory active:opacity-70 disabled:opacity-40"
                  >
                    Unlink
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => {
                    setLinkFor({ id: p.id, name: p.display_name });
                    setQuery(p.display_name);
                    setHits(null);
                  }}
                  disabled={busy}
                  className="shrink-0 text-[11.5px] font-semibold text-ink-2 border border-line rounded-full px-2.5 py-1 bg-ivory active:opacity-70 disabled:opacity-40"
                >
                  Link to account
                </button>
              )}
              {linkFor?.id === p.id && (
                <div className="mt-2 rounded-xl border border-line bg-ivory p-2.5">
                  <p className="text-[11px] text-warm-gray mb-1.5">
                    Who is <b className="text-ink-2">{p.display_name}</b>? Search by name or email.
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runSearch()}
                      className="flex-1 min-w-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px]"
                      placeholder="name or email"
                    />
                    <button
                      onClick={runSearch}
                      disabled={searching || query.trim().length < 2}
                      className="text-[11.5px] font-semibold text-ivory bg-graphite rounded-full px-3 disabled:opacity-40"
                    >
                      {searching ? "…" : "Find"}
                    </button>
                    <button
                      onClick={() => {
                        setLinkFor(null);
                        setHits(null);
                      }}
                      className="text-[11.5px] font-semibold text-warm-gray px-2"
                    >
                      Cancel
                    </button>
                  </div>
                  {hits && hits.length === 0 && (
                    <p className="text-[11.5px] text-warm-gray mt-2">No account matches that.</p>
                  )}
                  {hits?.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => link(p.id, h.id, h.label)}
                      disabled={busy}
                      className="w-full text-left mt-1.5 rounded-lg px-2.5 py-1.5 bg-surface border border-line active:bg-surface-2 disabled:opacity-40"
                    >
                      <span className="block text-[12.5px] font-semibold text-graphite">{h.label}</span>
                      {h.sublabel && <span className="block text-[11px] text-warm-gray">{h.sublabel}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </Section>

      <Section title={`Rounds (${data.rounds.length})`}>
        {data.rounds.length === 0 ? (
          <p className="text-[12.5px] text-warm-gray py-2">No rounds generated.</p>
        ) : (
          data.rounds.map((r) => (
            <div key={r.id} className="py-2 border-t border-line first:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <b className="text-[12.5px] font-semibold text-ink-2">Round {r.sequence}</b>
                <span className="text-[11px] text-warm-gray">
                  {r.status}
                  {r.generation_reason ? ` · ${r.generation_reason}` : ""}
                </span>
              </div>
              {r.matches.map((m) => (
                <div key={m.id} className="flex items-baseline justify-between gap-3 mt-1">
                  <span className="text-[12px] text-graphite truncate">
                    <span className="text-warm-gray">{m.court_label ?? "court"}</span> {m.team_a ?? "?"} vs{" "}
                    {m.team_b ?? "?"}
                  </span>
                  <span
                    className={`font-mono tnum text-[12px] shrink-0 ${
                      m.status === "final" ? "text-graphite" : "text-warm-gray"
                    }`}
                  >
                    {m.score_a ?? "–"} : {m.score_b ?? "–"}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </Section>

      <Section
        title={`Ratings written (${data.ratings.length})`}
        note={
          ended && data.ratings.length === 0
            ? "Nothing here on an ended session is the silent-failure signature — the rating write never landed."
            : undefined
        }
      >
        {data.ratings.length === 0 ? (
          <p className="text-[12.5px] text-warm-gray py-2">None.</p>
        ) : (
          data.ratings.map((h) => (
            <div key={h.user_id} className="flex items-baseline justify-between gap-3 py-1.5 border-t border-line first:border-t-0">
              <span className="text-[12.5px] text-graphite truncate">{h.display_name ?? h.user_id.slice(0, 8)}</span>
              <span className="font-mono tnum text-[12.5px] shrink-0">
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

      {data.league_rows.length > 0 && (
        <Section title={`League rows (${data.league_rows.length})`}>
          {data.league_rows.map((l) => (
            <Row
              key={l.user_id}
              label={`${l.rank}. ${l.display_name ?? l.user_id.slice(0, 8)}`}
              value={`${l.placement_points + l.podium_bonus} pts · ${l.wins}W ${l.losses}L ${l.draws}D`}
            />
          ))}
        </Section>
      )}

      {data.join_requests.length > 0 && (
        <Section title={`Join requests (${data.join_requests.length})`}>
          {data.join_requests.map((j) => (
            <Row key={j.id} label={`${j.display_name}${j.email ? ` · ${j.email}` : ""}`} value={j.status} />
          ))}
        </Section>
      )}

      {data.claims.length > 0 && (
        <Section title={`Claims (${data.claims.length})`}>
          {data.claims.map((c) => (
            <Row key={c.id} label={c.claimant ?? c.claimant_user_id ?? "unknown"} value={c.status} />
          ))}
        </Section>
      )}

      {data.score_edits.length > 0 && (
        <Section title={`Score edits (${data.score_edits.length})`}>
          {data.score_edits.map((e) => (
            <Row
              key={e.id}
              label={`${e.edited_by ?? "someone"}${e.reason ? ` · ${e.reason}` : ""}`}
              value={`${e.old_score_a ?? "–"}:${e.old_score_b ?? "–"} → ${e.new_score_a ?? "–"}:${e.new_score_b ?? "–"}`}
            />
          ))}
        </Section>
      )}

      <Link to="/admin" className="block text-center text-[12.5px] font-semibold text-warm-gray mt-6 active:opacity-70">
        ‹ Back to the console
      </Link>
    </div>
  );
}
