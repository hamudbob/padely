import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getClubChampions, ClubChampions } from "../../lib/supabase/championsQueries";
import { getTeam } from "../../lib/supabase/teamQueries";
import { useBackNav } from "../../lib/useBackNav";
import { SkeletonScreen, SkeletonBlock, SkeletonRows } from "../shell/Skeleton";

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s&]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
const MEDAL = ["🥇", "🥈", "🥉"];

export default function ChampionsPage() {
  const { teamId } = useParams();
  const back = useBackNav(teamId ? `/teams/${teamId}` : "/teams");
  const [data, setData] = useState<ClubChampions | null>(null);
  const [teamName, setTeamName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notAllowed, setNotAllowed] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    getClubChampions(teamId)
      .then(setData)
      .catch(() => setNotAllowed(true))
      .finally(() => setLoading(false));
    getTeam(teamId).then((t) => t && setTeamName(t.name)).catch(() => {});
  }, [teamId]);

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";
  const topBar = (
    <div className="flex items-center justify-between mb-2">
      <button onClick={back} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (loading)
    return (
      <div className={shell}>
        {topBar}
        <SkeletonScreen label="Loading the champions">
          <SkeletonBlock h={184} className="mb-6" />
          <SkeletonRows n={5} avatar />
        </SkeletonScreen>
      </div>
    );
  if (notAllowed || !data) return <div className={shell}>{topBar}<p className="text-[13px] text-warm-gray mt-16 text-center">This hall isn't available.</p></div>;

  const { titles, recent } = data;
  const empty = titles.length === 0 && recent.length === 0;

  return (
    <div className={shell}>
      {topBar}

      {/* Identity */}
      <div className="text-center pt-4">
        <div className="w-[64px] h-[64px] rounded-2xl bg-gold-soft flex items-center justify-center mx-auto text-[30px]" aria-hidden>👑</div>
        <h1 className="font-serif text-[27px] font-semibold text-graphite tracking-tight mt-3">Champions Hall</h1>
        {teamName && <p className="text-[12.5px] text-warm-gray mt-1">{teamName}</p>}
      </div>

      {empty ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] font-semibold text-ink-2">No champions yet</p>
          <p className="text-[12px] text-warm-gray mt-1.5 leading-relaxed">Finish a club session and its winner is crowned here.</p>
        </div>
      ) : (
        <>
          {/* Titles board */}
          {titles.length > 0 && (
            <>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-8 mb-2 px-0.5">Most titles</h3>
              <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
                {titles.map((t, i) => (
                  <Link
                    key={t.userId}
                    to={`/u/${t.userId}`}
                    className={`flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors ${i === 0 ? "bg-gold-soft/50" : ""}`}
                  >
                    <span className={`w-5 text-center font-mono tnum text-[13px] font-bold ${i === 0 ? "text-gold-ink" : "text-warm-gray"}`}>{i + 1}</span>
                    <span className="w-[34px] h-[34px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[13px] font-semibold overflow-hidden shrink-0">
                      {t.avatarUrl ? <img src={t.avatarUrl} alt="" className="w-full h-full object-cover" /> : initialsOf(t.name)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <b className="block text-[14px] font-semibold text-graphite truncate">{t.name}</b>
                      <span className="block text-[11px] text-warm-gray">{t.podiums} podium{t.podiums === 1 ? "" : "s"} · {t.sessions} played</span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="font-mono tnum text-[17px] font-semibold text-gold-ink">{t.titles}</span>
                      <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-warm-gray -mt-0.5">{t.titles === 1 ? "title" : "titles"}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {/* Recent champions */}
          {recent.length > 0 && (
            <>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-8 mb-2 px-0.5">Recent champions</h3>
              <div className="flex flex-col gap-2.5">
                {recent.map((s) => (
                  <div key={s.sessionId} className="rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
                    {/* The session name is a door. /session/<id>/final is public
                        for any non-draft session, so a member can open the
                        podium and full standings of a night they played — which
                        is what someone reading a champions list is actually
                        curious about. */}
                    <Link to={`/session/${s.sessionId}/final`} className="flex items-baseline justify-between gap-2 active:opacity-70">
                      <b className="text-[13.5px] font-semibold text-graphite truncate">
                        {s.sessionName}
                        <span className="text-stone font-normal"> ›</span>
                      </b>
                      <span className="text-[11px] text-warm-gray shrink-0">{shortDate(s.sessionDate)}</span>
                    </Link>
                    <Link to={`/u/${s.champion.userId}`} className="flex items-center gap-2.5 mt-2.5 active:opacity-70">
                      <span className="w-[36px] h-[36px] rounded-full bg-gold-soft text-gold-ink border border-gold/30 flex items-center justify-center text-[14px] font-semibold overflow-hidden shrink-0">
                        {s.champion.avatarUrl ? <img src={s.champion.avatarUrl} alt="" className="w-full h-full object-cover" /> : initialsOf(s.champion.name)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span aria-hidden>🥇</span>
                          <b className="text-[14px] font-semibold text-graphite truncate">{s.champion.name}</b>
                        </span>
                        <span className="block text-[11px] text-warm-gray">Champion · {s.champion.points} pts · {s.fieldSize} players</span>
                      </span>
                    </Link>
                    {s.podium.length > 1 && (
                      <p className="text-[11.5px] text-warm-gray mt-2.5 pt-2.5 border-t border-line flex flex-wrap gap-x-3 gap-y-1">
                        {s.podium.map((p) => (
                          <span key={p.rank}>
                            <span aria-hidden>{MEDAL[p.rank - 1] ?? "•"}</span> {firstNameOf(p.name)}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
