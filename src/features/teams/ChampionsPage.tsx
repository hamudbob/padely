import { useState } from "react";
import { Link } from "react-router-dom";
import { getClubChampions } from "../../lib/supabase/championsQueries";
import { getClubLeagueHistory, SeasonPodium } from "../../lib/supabase/leagueQueries";
import { SkeletonScreen, SkeletonBlock, SkeletonRows } from "../shell/Skeleton";
import { useCachedQuery } from "../../lib/cache/useCachedQuery";
import { Face, Podium, Segmented, card } from "./club/ui";

/**
 * The Champions tab of the club page (ADR-002). Built from the same parts as
 * the League tab: a title row with one switch, a podium card, then rows.
 * Was its own page until Nov 2026; /teams/:id/champions opens this tab.
 */

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
function monthDay(iso: string): { m: string; d: string } {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return { m: "", d: "–" };
  return { m: t.toLocaleDateString(undefined, { month: "short" }).toUpperCase(), d: String(t.getDate()) };
}

export function ChampionsTab({ teamId, userId }: { teamId: string; userId: string | undefined }) {
  const [view, setView] = useState<"nights" | "seasons">("nights");
  const championsQ = useCachedQuery(`club:${teamId}:champions`, () => getClubChampions(teamId));
  const historyQ = useCachedQuery(view === "seasons" ? `club:${teamId}:league-history` : null, () => getClubLeagueHistory(teamId));
  const data = championsQ.data;
  const history = historyQ.data;

  const crowned = data?.recent.length ?? 0;
  const winners = new Set(data?.recent.map((r) => r.champion.userId) ?? []).size;
  const myTitles = data?.titles.find((t) => t.userId === userId)?.titles ?? 0;

  return (
    <div className="px-5">
      <div className="flex items-center justify-between gap-3 mt-5">
        <span className="min-w-0">
          <span className="block font-serif text-[18px] font-semibold text-graphite">{view === "nights" ? "Night champions" : "Season champions"}</span>
          <span className="block text-[11.5px] text-warm-gray mt-0.5 truncate">
            {view === "nights"
              ? data
                ? `${crowned} ${crowned === 1 ? "night" : "nights"} · ${winners} ${winners === 1 ? "winner" : "winners"}`
                : " "
              : history
                ? `${history.finished.length} ${history.finished.length === 1 ? "season" : "seasons"} finished`
                : " "}
          </span>
        </span>
        <div className="w-[150px] shrink-0">
          <Segmented
            small
            label="Champions"
            value={view}
            onChange={setView}
            options={[
              { value: "nights", label: "Nights" },
              { value: "seasons", label: "Seasons" },
            ]}
          />
        </div>
      </div>

      {view === "nights" ? (
        !data ? (
          championsQ.error ? (
            <p className="text-[13px] text-warm-gray mt-10 text-center">Couldn't load the champions just now.</p>
          ) : (
            <SkeletonScreen label="Loading the champions">
              <SkeletonBlock h={170} className="mt-4 mb-4" />
              <SkeletonRows n={4} avatar />
            </SkeletonScreen>
          )
        ) : data.titles.length === 0 && data.recent.length === 0 ? (
          <Empty title="No champions yet" body="Finish a club session and its winner is crowned here." />
        ) : (
          <>
            {data.titles.length > 0 && (
              <div className={`mt-3.5 ${card} px-4 pt-[18px] pb-3.5`}>
                <Podium
                  entries={data.titles.slice(0, 3).map((t) => ({
                    key: t.userId,
                    name: t.name,
                    avatarUrl: t.avatarUrl,
                    value: String(t.titles),
                    unit: `${t.titles === 1 ? "title" : "titles"} · ${t.podiums} ${t.podiums === 1 ? "podium" : "podiums"}`,
                    href: `/u/${t.userId}`,
                  }))}
                />
                <p className="text-[11.5px] text-warm-gray text-center mt-3">
                  Most titles{myTitles > 0 && !data.titles.slice(0, 3).some((t) => t.userId === userId) ? ` · you have ${myTitles}` : ""}
                </p>
              </div>
            )}
            {data.titles.length > 3 && (
              <div className={`mt-2 ${card} px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1`}>
                {data.titles.slice(3, 9).map((t) => (
                  <Link key={t.userId} to={`/u/${t.userId}`} className="text-[12.5px] text-graphite">
                    {t.name} <span className="text-warm-gray">· {t.titles}</span>
                  </Link>
                ))}
              </div>
            )}

            {data.recent.length > 0 && (
              <>
                <h2 className="font-serif text-[18px] font-semibold text-graphite mt-6 px-0.5">Recent nights</h2>
                <div className={`mt-2.5 ${card} overflow-hidden`}>
                  {data.recent.map((s) => {
                    const md = monthDay(s.sessionDate);
                    const me = s.champion.userId === userId;
                    const others = s.podium.filter((p) => p.rank > 1).slice(0, 2);
                    return (
                      <Link
                        key={s.sessionId}
                        to={`/session/${s.sessionId}/final`}
                        className={`flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0 active:bg-surface-2 ${me ? "bg-gold-soft" : ""}`}
                      >
                        <span className="w-[30px] text-center shrink-0" aria-hidden>
                          <span className="block text-[8.5px] font-bold tracking-[0.1em] text-gold-ink">{md.m}</span>
                          <span className="block font-serif text-[15px] font-semibold text-graphite leading-tight">{md.d}</span>
                        </span>
                        <Face name={s.champion.name} url={s.champion.avatarUrl} gold={!s.champion.avatarUrl && !me} />
                        <span className="flex-1 min-w-0">
                          <b className="block text-[14.5px] font-semibold text-graphite truncate">
                            {s.champion.name}
                            {me && <span className="font-normal text-warm-gray"> · you</span>}
                          </b>
                          <span className="block text-[11px] text-warm-gray truncate">
                            {[s.sessionName, ...others.map((p) => `${p.rank === 2 ? "2nd" : "3rd"} ${firstNameOf(p.name)}`)].join(" · ")}
                          </span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className="font-mono tnum text-[18px] font-semibold text-graphite leading-none">{s.champion.points}</span>
                          <span className="block text-[9px] font-semibold text-warm-gray mt-0.5">pts</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )
      ) : (
        <SeasonsView history={history ?? null} loading={historyQ.loading} failed={Boolean(historyQ.error) && !history} userId={userId} />
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-5 rounded-[22px] border-[1.5px] border-dashed border-stone px-5 py-7 text-center">
      <p className="text-[13.5px] font-semibold text-ink-2">{title}</p>
      <p className="text-[12px] text-warm-gray mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function SeasonsView({
  history,
  loading,
  failed,
  userId,
}: {
  history: import("../../lib/supabase/leagueQueries").LeagueHistory | null;
  loading: boolean;
  failed: boolean;
  userId: string | undefined;
}) {
  if (loading && !history) {
    return (
      <SkeletonScreen label="Loading the season champions">
        <SkeletonBlock h={160} className="mt-4 mb-3" />
        <SkeletonRows n={3} avatar />
      </SkeletonScreen>
    );
  }
  if (failed || !history) return <p className="text-[13px] text-warm-gray mt-10 text-center">Couldn't load the season champions just now.</p>;
  const { finished, current, titles } = history;
  if (finished.length === 0 && (!current || current.podium.length === 0)) {
    return <Empty title="No season champions yet" body="When a season ends, its top three are kept here for good." />;
  }
  return (
    <>
      {titles.length > 0 && (
        <div className={`mt-3.5 ${card} px-4 pt-[18px] pb-3.5`}>
          <Podium
            entries={titles.slice(0, 3).map((t) => ({
              key: t.userId,
              name: t.displayName,
              avatarUrl: t.avatarUrl,
              value: String(t.titles),
              unit: `${t.titles === 1 ? "season" : "seasons"} · ${t.podiums} ${t.podiums === 1 ? "podium" : "podiums"}`,
              href: `/u/${t.userId}`,
            }))}
          />
          <p className="text-[11.5px] text-warm-gray text-center mt-3">Most seasons won</p>
        </div>
      )}
      {current && current.podium.length > 0 && (
        <>
          <h2 className="font-serif text-[18px] font-semibold text-graphite mt-6 px-0.5">This season so far</h2>
          <SeasonRows seasons={[current]} inProgress userId={userId} />
        </>
      )}
      {finished.length > 0 && (
        <>
          <h2 className="font-serif text-[18px] font-semibold text-graphite mt-6 px-0.5">Past seasons</h2>
          <SeasonRows seasons={finished} userId={userId} />
        </>
      )}
    </>
  );
}

function SeasonRows({ seasons, inProgress = false, userId }: { seasons: SeasonPodium[]; inProgress?: boolean; userId: string | undefined }) {
  return (
    <div className={`mt-2.5 ${card} overflow-hidden`}>
      {seasons.map((s) => {
        const [champ, ...rest] = s.podium;
        if (!champ) return null;
        const me = champ.userId === userId;
        return (
          <Link
            key={s.start}
            to={`/u/${champ.userId}`}
            className={`flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0 active:bg-surface-2 ${me ? "bg-gold-soft" : ""}`}
          >
            <span className="w-[30px] text-center shrink-0 font-mono text-[12px] font-semibold text-gold-ink" aria-hidden>
              S{s.number}
            </span>
            <Face name={champ.displayName} url={champ.avatarUrl} gold={!champ.avatarUrl && !me} />
            <span className="flex-1 min-w-0">
              <b className="block text-[14.5px] font-semibold text-graphite truncate">
                {champ.displayName}
                {me && <span className="font-normal text-warm-gray"> · you</span>}
              </b>
              <span className="block text-[11px] text-warm-gray truncate">
                {[inProgress ? `Leading ${s.dates}` : s.dates, ...rest.map((p, i) => `${i === 0 ? "2nd" : "3rd"} ${firstNameOf(p.displayName)}`)].join(" · ")}
              </span>
            </span>
            <span className="text-right shrink-0">
              <span className="font-mono tnum text-[18px] font-semibold text-graphite leading-none">{champ.pointsPerSession.toFixed(1)}</span>
              <span className="block text-[9px] font-semibold text-warm-gray mt-0.5">/ night</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
