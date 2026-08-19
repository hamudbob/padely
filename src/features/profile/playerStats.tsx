import { ReactNode } from "react";
import { Link } from "react-router-dom";
import HelpDot from "../shell/HelpDot";
import { PeerStat } from "../../lib/supabase/insightsQueries";

/**
 * The shared visual language for a player's record.
 *
 * The You tab and the public profile show the SAME facts in different amounts,
 * and until now they also showed them in different shapes — one dense card
 * versus a set of sections, form squares versus form pills. That's the kind of
 * drift that happens when two screens grow at different times, and it makes the
 * app feel like two apps.
 *
 * These are the pieces both screens now build from, so a change to how a record
 * looks happens once. What differs between the screens is *which* pieces they
 * use — deliberately, see below.
 *
 * ── The privacy line ────────────────────────────────────────────────────────
 * The You tab shows more than the public profile, and that gap is intentional.
 * Best partner and toughest rival name ANOTHER player and expose that person's
 * head-to-head record. That's fair to show you about your own games; it is not
 * something a stranger should be able to read off a shared link about someone
 * who never agreed to it. So those pieces are used by the You tab only, and
 * get_public_profile (0027) deliberately doesn't even return the data.
 */

export type FormResult = "W" | "L" | "D";

/**
 * The club's own tier names, set by Hamud. Deliberately in-jokes rather than
 * generic labels — "cacing sr" is a word from the group chat and people will
 * actually talk about it, which "Steady" never managed.
 *
 * The BANDS are tuned to how ratings really spread here, which is far narrower
 * than the raw Glicko scale suggests. Simulating 200 average players on this
 * app's own rating code, their settled ratings only ranged 1379–1621, so the
 * original boundary at 1500 sat dead in the middle of ordinary variation and
 * flipped people's label on noise alone. Measured over those players the old
 * bands changed a label 2.34 times on average; these change it 0.48 times.
 *
 * The middle band ("cacing sr") is 150 wide and centred on 1500, the starting
 * rating, so one bad night can't demote someone who hasn't actually got worse.
 * It's also where most of the club will sit — that's the joke working, not a
 * bug.
 *
 * Known and accepted: in a ~16-player club nobody reaches "ahmad" (1850). The
 * strongest player in simulation finished on 1849. It's a myth tier by choice;
 * 1800 would make it attainable if that ever changes.
 */
export function tierFor(rating: number, provisional: boolean): string {
  // Not a skill judgement and not the bottom rung: the rating deviation is
  // still too wide to trust the number at all. Takes about three sessions to
  // clear, win or lose — hence an instruction ("play more") rather than a rank,
  // which is the one label that can't be misread as a verdict on a new player.
  if (provisional) return "main lagi";
  if (rating < 1300) return "fuad";
  if (rating < 1425) return "cacing";
  if (rating < 1575) return "cacing sr";
  if (rating < 1725) return "lumayan";
  if (rating < 1850) return "jago";
  return "ahmad";
}

export function memberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function FormPill({ r }: { r: FormResult }) {
  const style = r === "W" ? "bg-win-soft text-win" : r === "L" ? "bg-loss-soft text-loss" : "bg-stone/40 text-ink-2";
  return (
    <span className={`w-[22px] h-[22px] rounded-md flex items-center justify-center text-[11px] font-bold ${style}`}>
      {r}
    </span>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-[13px] font-semibold text-ink-2 mt-7 mb-2 px-0.5">{children}</h3>;
}

export function StatCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">{children}</div>;
}

/** Rating · Tier · Games — the three-up strip under the identity block. */
export function RatingStrip({
  rating,
  provisional,
  games,
}: {
  rating: number;
  provisional: boolean;
  games: number;
}) {
  return (
    <>
      <div className="flex rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
        <div className="flex-1 py-3.5 text-center">
          {/* The "?" rides the label, not the number: it explains what this
              column means, and putting it on the figure would read as a doubt
              about the figure itself. */}
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">
            {/* The dot hangs off the label rather than sitting in the line with
                it. In flow it would do two things I don't want: grow the line
                box (dropping this column's number below Tier and Games), and
                shift "RATING" left of the number it labels, because a centred
                row centres the pair, not the word. Out of flow it costs the
                layout nothing. */}
            <span className="relative inline-block">
              Rating
              {/* The wrapper is what's positioned, not the dot: HelpDot carries
                  `relative` for its own hit-area pseudo-element, and Tailwind
                  emits .relative after .absolute, so an `absolute` passed in
                  would quietly lose. */}
              <span className="absolute left-full top-1/2 -translate-y-1/2 ml-[7px] leading-none">
                <HelpDot topic="rating" label="How the rating works" />
              </span>
            </span>
          </p>
          <p className="font-mono tnum text-[24px] font-semibold text-graphite leading-none mt-1.5">{Math.round(rating)}</p>
        </div>
        <div className="w-px bg-line" />
        <div className="flex-1 py-3.5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Tier</p>
          {/* Uppercased in CSS, not in the strings — tierFor returns data, this
              decides how it looks. Set a size down from 14.5px because caps
              read optically larger at the same point size, and given positive
              tracking, which uppercase needs to stop it looking cramped. */}
          <p className="text-[13px] font-bold uppercase tracking-[0.09em] text-gold-ink leading-none mt-[11px]">
            {tierFor(rating, provisional)}
          </p>
        </div>
        <div className="w-px bg-line" />
        <div className="flex-1 py-3.5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Games</p>
          <p className="font-mono tnum text-[24px] font-semibold text-graphite leading-none mt-1.5">{games}</p>
        </div>
      </div>
      {provisional && (
        <p className="text-[11px] text-warm-gray text-center mt-2">Rating still settling — it sharpens with more games.</p>
      )}
    </>
  );
}

/**
 * The record card: win rate, W·L·D, a proportional bar, and recent form.
 * `emptyLabel` differs by screen — "you" versus "they" — so the copy stays
 * natural without forking the component.
 *
 * `onOpen` makes the whole card a button into the detail sheet. It's optional
 * because only your own profile has the detail: the public one is built from
 * get_public_profile, which deliberately doesn't return anyone's points,
 * streaks or full history.
 */
export function RecordCard({
  wins,
  losses,
  draws,
  form,
  emptyLabel,
  onOpen,
}: {
  wins: number;
  losses: number;
  draws: number;
  form: FormResult[];
  emptyLabel: string;
  onOpen?: () => void;
}) {
  const matches = wins + losses + draws;
  const winRate = matches > 0 ? wins / matches : 0;
  const pct = (n: number) => (n / (matches || 1)) * 100;

  const card = (
    <StatCard>
      {matches === 0 ? (
        <p className="text-[12.5px] text-warm-gray text-center py-1.5">{emptyLabel}</p>
      ) : (
        <>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Win rate</p>
              <p className="font-mono tnum text-[30px] font-semibold text-graphite leading-none mt-1.5">
                {Math.round(winRate * 100)}
                <span className="text-[15px] text-warm-gray font-semibold">%</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">W · L · D</p>
              <p className="font-mono tnum text-[17px] font-semibold mt-1.5 leading-none">
                <span className="text-win">{wins}</span>
                <span className="text-stone"> · </span>
                <span className="text-loss">{losses}</span>
                <span className="text-stone"> · </span>
                <span className="text-warm-gray">{draws}</span>
              </p>
            </div>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden mt-4 bg-stone/40">
            {wins > 0 && <div className="bg-win" style={{ width: `${pct(wins)}%` }} />}
            {losses > 0 && <div className="bg-loss" style={{ width: `${pct(losses)}%` }} />}
            {draws > 0 && <div className="bg-warm-gray/50" style={{ width: `${pct(draws)}%` }} />}
          </div>
          <p className="text-[10.5px] text-warm-gray mt-1.5">
            {matches} {matches === 1 ? "game" : "games"} played
          </p>
          {form.length > 0 && (
            <div className="flex items-center justify-between mt-3.5 pt-3.5 border-t border-line">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Recent form</span>
              <div className="flex gap-1.5">
                {form.map((f, i) => (
                  <FormPill key={i} r={f} />
                ))}
              </div>
            </div>
          )}
          {onOpen && (
            <p className="text-[12px] font-semibold text-gold-ink mt-3.5 pt-3.5 border-t border-line">
              Points, streaks and the last 30 days ›
            </p>
          )}
        </>
      )}
    </StatCard>
  );

  // A card that does nothing shouldn't look like a button, and a card that
  // does something shouldn't rely on the reader guessing — hence the line
  // above, and a real <button> so the keyboard and screen readers get it too.
  if (!onOpen || matches === 0) return card;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open your full record"
      className="w-full text-left active:scale-[0.99] transition-transform"
    >
      {card}
    </button>
  );
}

/** Rating-over-time line. Green when the last point is at or above the first. */
export function RatingSparkline({ points, width = 112, height = 34 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const d = points
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + (height - pad * 2) * (1 - (v - min) / span);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const rising = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={rising ? "#27754A" : "#AE4A2A"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendCard({ rating, points, lastDelta }: { rating: number; points: number[]; lastDelta: number }) {
  return (
    <StatCard>
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-mono tnum text-[20px] font-semibold text-graphite leading-none">{Math.round(rating)}</p>
        {lastDelta !== 0 && (
          <span className={`text-[12px] font-semibold ${lastDelta > 0 ? "text-win" : "text-loss"}`}>
            {lastDelta > 0 ? "+" : ""}
            {Math.round(lastDelta)} last session
          </span>
        )}
      </div>
      <RatingSparkline points={points} width={300} height={56} />
    </StatCard>
  );
}



/** Their photo, or the first letter of their name. */
function PeerFace({ peer }: { peer: PeerStat }) {
  if (peer.avatarUrl) {
    return (
      <img
        src={peer.avatarUrl}
        alt=""
        className="w-[34px] h-[34px] rounded-full object-cover border border-line shrink-0"
      />
    );
  }
  return (
    <span className="w-[34px] h-[34px] rounded-full bg-gold-soft text-gold-ink flex items-center justify-center text-[13px] font-semibold shrink-0">
      {peer.label.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * One partner or rival.
 *
 * The head-to-head reads from YOUR side either way — "7–3 together" is your
 * wins and losses alongside them, "2–6 against" is your wins and losses facing
 * them. Same number, same direction, so the two lists can be read at a glance
 * without working out whose record you're looking at.
 *
 * It becomes a link when that person has an account. Most players in a session
 * never signed up — the host typed their name — so a row that always looked
 * tappable would be wrong most of the time.
 */
export function PeerRow({ peer, kind }: { peer: PeerStat; kind: "partner" | "rival" }) {
  const record = `${peer.wins}–${peer.losses}${peer.draws > 0 ? `–${peer.draws}` : ""}`;
  const body = (
    <>
      <PeerFace peer={peer} />
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold text-graphite truncate">{peer.label}</span>
        <span className="block text-[11.5px] text-warm-gray mt-0.5">
          {peer.matches} {peer.matches === 1 ? "game" : "games"} {kind === "partner" ? "together" : "against"}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className="block font-mono tnum text-[14px] font-semibold text-graphite">{record}</span>
        <span className="block text-[10.5px] text-warm-gray mt-0.5">
          {Math.round(peer.winRate * 100)}% won
        </span>
      </span>
      {peer.userId && (
        <span className="text-stone text-[15px] shrink-0" aria-hidden>
          ›
        </span>
      )}
    </>
  );

  const className = "flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0";
  if (!peer.userId) return <div className={className}>{body}</div>;
  return (
    <Link to={`/u/${peer.userId}`} className={`${className} active:bg-surface-2 transition-colors`}>
      {body}
    </Link>
  );
}
