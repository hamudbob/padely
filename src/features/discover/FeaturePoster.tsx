import { useState } from "react";

/**
 * The posters.
 *
 * Drawn in code, not photographed. Three reasons, in order of how much they
 * matter: a padel app used on a court needs pages that load on one bar of
 * signal, stock photos of strangers playing padel look like every other padel
 * app, and a drawing can show the one thing the format actually does — who
 * partners whom, which side you stand on, how a rank becomes a pairing.
 *
 * Six drawings serve all the features, differing by variant rather than by
 * being twenty separate illustrations. A court is a court; what changes is
 * what's marked on it.
 */

export type PosterKind =
  | "rotation"   // partners change every round
  | "rank"       // pairing comes from the standings
  | "mixed"      // every team one of each
  | "sides"      // every team one left + one right
  | "pair"       // two players locked together
  | "teams"      // A vs B
  | "crest"      // a club
  | "table"      // a league / standings
  | "trophy"     // champions
  | "calendar"   // scheduled sessions
  | "dial"       // a rating
  | "chart"      // a record over time
  | "person"     // a public profile
  | "code"       // join by code
  | "screen"     // watch live
  | "cloud"      // works with no signal
  | "tools"      // host controls
  | "claim"      // an empty place being taken
  | "scale"      // how the board is ordered — points vs wins
  | "target";    // scoring formats

const COURT_LINE = "#D6D3CE";
const INK = "#0D0D0D";
const GOLD = "#BFA36A";
const GOLD_INK = "#836529";

/** The court itself: the frame every format drawing sits on. */
function Court({ children }: { children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 200" className="w-full h-full" role="img" aria-hidden>
      <rect x="40" y="26" width="240" height="148" rx="4" fill="none" stroke={COURT_LINE} strokeWidth="2" />
      {/* the net, across the middle */}
      <line x1="160" y1="26" x2="160" y2="174" stroke={COURT_LINE} strokeWidth="2" strokeDasharray="3 4" />
      {/* service lines */}
      <line x1="96" y1="26" x2="96" y2="174" stroke={COURT_LINE} strokeWidth="1" />
      <line x1="224" y1="26" x2="224" y2="174" stroke={COURT_LINE} strokeWidth="1" />
      <line x1="40" y1="100" x2="96" y2="100" stroke={COURT_LINE} strokeWidth="1" />
      <line x1="224" y1="100" x2="280" y2="100" stroke={COURT_LINE} strokeWidth="1" />
      {children}
    </svg>
  );
}

function Player({ x, y, label, tone = "ink" }: { x: number; y: number; label?: string; tone?: "ink" | "gold" }) {
  const fill = tone === "gold" ? GOLD : INK;
  return (
    <g>
      <circle cx={x} cy={y} r="13" fill={fill} />
      {label && (
        <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={tone === "gold" ? INK : "#F7F5F2"}>
          {label}
        </text>
      )}
    </g>
  );
}

function Arrow({ from, to }: { from: [number, number]; to: [number, number] }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - 26;
  return (
    <g>
      <path d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`} fill="none" stroke={GOLD_INK} strokeWidth="1.6" strokeDasharray="4 3" />
      <circle cx={x2} cy={y2} r="2.5" fill={GOLD_INK} />
    </g>
  );
}

export default function FeaturePoster({ kind, slug }: { kind: PosterKind; slug?: string }) {
  // A logo dropped into public/features/<slug>.svg (or .png) replaces the drawn
  // poster with no code change. Try svg, then png, then fall back to the
  // drawing — so a half-finished set never leaves a blank card, and each new
  // file simply appears.
  const [artStep, setArtStep] = useState<0 | 1 | 2>(0);
  const artSrc = slug && artStep < 2 ? `/features/${slug}.${artStep === 0 ? "svg" : "png"}` : null;

  return (
    <div className="w-full aspect-[16/10] rounded-[20px] bg-gradient-to-br from-gold-soft to-ivory border border-line overflow-hidden relative">
      {artSrc && (
        <img
          src={artSrc}
          alt=""
          onError={() => setArtStep((step) => (step === 0 ? 1 : 2))}
          className="absolute inset-0 w-full h-full object-contain p-5"
        />
      )}
      <div className={`absolute inset-0 p-2 ${artSrc ? "invisible" : ""}`}>
        {kind === "rotation" && (
          <Court>
            <Player x={70} y={70} />
            <Player x={70} y={130} />
            <Player x={250} y={70} />
            <Player x={250} y={130} />
            <Arrow from={[70, 70]} to={[250, 70]} />
            <Arrow from={[250, 130]} to={[70, 130]} />
          </Court>
        )}

        {kind === "rank" && (
          <Court>
            <Player x={70} y={70} label="1" tone="gold" />
            <Player x={70} y={130} label="4" />
            <Player x={250} y={70} label="2" />
            <Player x={250} y={130} label="3" />
            <text x="160" y="192" textAnchor="middle" fontSize="10" fontWeight="700" fill={GOLD_INK} letterSpacing="1.5">
              1+4 vs 2+3
            </text>
          </Court>
        )}

        {kind === "mixed" && (
          <Court>
            <Player x={70} y={70} label="M" />
            <Player x={70} y={130} label="F" tone="gold" />
            <Player x={250} y={70} label="F" tone="gold" />
            <Player x={250} y={130} label="M" />
          </Court>
        )}

        {kind === "sides" && (
          <Court>
            <Player x={70} y={70} label="L" />
            <Player x={70} y={130} label="R" tone="gold" />
            <Player x={250} y={70} label="L" />
            <Player x={250} y={130} label="R" tone="gold" />
            <line x1="40" y1="100" x2="280" y2="100" stroke={GOLD} strokeWidth="1" strokeDasharray="2 4" />
          </Court>
        )}

        {kind === "pair" && (
          <Court>
            <Player x={70} y={70} />
            <Player x={70} y={130} />
            <path d="M 52 60 Q 40 100 52 140" fill="none" stroke={GOLD_INK} strokeWidth="2" />
            <Player x={250} y={70} tone="gold" />
            <Player x={250} y={130} tone="gold" />
            <path d="M 268 60 Q 280 100 268 140" fill="none" stroke={GOLD_INK} strokeWidth="2" />
          </Court>
        )}

        {kind === "teams" && (
          <Court>
            <rect x="40" y="26" width="120" height="148" fill={INK} opacity="0.06" />
            <rect x="160" y="26" width="120" height="148" fill={GOLD} opacity="0.16" />
            <Player x={70} y={70} />
            <Player x={70} y={130} />
            <Player x={250} y={70} tone="gold" />
            <Player x={250} y={130} tone="gold" />
            <text x="100" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>A</text>
            <text x="220" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill={GOLD_INK}>B</text>
          </Court>
        )}

        {(kind === "crest" || kind === "trophy") && (
          <svg viewBox="0 0 320 200" className="w-full h-full" role="img" aria-hidden>
            <path
              d="M160 30 L232 52 V108 C232 142 200 164 160 176 C120 164 88 142 88 108 V52 Z"
              fill="none"
              stroke={kind === "trophy" ? GOLD : COURT_LINE}
              strokeWidth="2"
            />
            {kind === "crest" ? (
              <>
                <circle cx="134" cy="96" r="13" fill={INK} />
                <circle cx="186" cy="96" r="13" fill={GOLD} />
                <circle cx="160" cy="128" r="13" fill={INK} opacity="0.55" />
              </>
            ) : (
              <>
                <path d="M138 78 h44 v18 a22 22 0 0 1 -44 0 Z" fill={GOLD} />
                <rect x="152" y="118" width="16" height="20" fill={INK} />
                <rect x="140" y="138" width="40" height="6" rx="3" fill={INK} />
              </>
            )}
          </svg>
        )}

        {(kind === "table" || kind === "chart") && (
          <svg viewBox="0 0 320 200" className="w-full h-full" role="img" aria-hidden>
            {kind === "table"
              ? [0, 1, 2, 3].map((i) => (
                  <g key={i}>
                    <rect x="56" y={44 + i * 32} width="208" height="22" rx="6" fill={i === 0 ? GOLD : INK} opacity={i === 0 ? 0.9 : 0.08} />
                    <rect x="66" y={51 + i * 32} width={90 - i * 16} height="8" rx="4" fill={i === 0 ? "#F7F5F2" : INK} opacity={i === 0 ? 0.9 : 0.5} />
                    <rect x="228" y={51 + i * 32} width="26" height="8" rx="4" fill={i === 0 ? "#F7F5F2" : INK} opacity={i === 0 ? 0.9 : 0.35} />
                  </g>
                ))
              : (
                  <>
                    <polyline
                      points="56,150 100,132 144,138 188,104 232,88 264,60"
                      fill="none"
                      stroke={GOLD_INK}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    {[[56, 150], [100, 132], [144, 138], [188, 104], [232, 88], [264, 60]].map(([x, y]) => (
                      <circle key={`${x}`} cx={x} cy={y} r="3.5" fill={GOLD_INK} />
                    ))}
                    <line x1="46" y1="168" x2="274" y2="168" stroke={COURT_LINE} strokeWidth="1.5" />
                  </>
                )}
          </svg>
        )}

        {kind === "dial" && (
          <svg viewBox="0 0 320 200" className="w-full h-full" role="img" aria-hidden>
            <path d="M84 150 A 76 76 0 1 1 236 150" fill="none" stroke={COURT_LINE} strokeWidth="14" strokeLinecap="round" />
            <path d="M84 150 A 76 76 0 0 1 196 84" fill="none" stroke={GOLD} strokeWidth="14" strokeLinecap="round" />
            <text x="160" y="140" textAnchor="middle" fontSize="34" fontWeight="600" fill={INK} fontFamily="Space Grotesk, monospace">
              1587
            </text>
          </svg>
        )}

        {(kind === "person" || kind === "tools") && (
          <svg viewBox="0 0 320 200" className="w-full h-full" role="img" aria-hidden>
            {kind === "person" ? (
              <>
                <circle cx="160" cy="80" r="26" fill={INK} />
                <path d="M108 168 C108 132 132 116 160 116 C188 116 212 132 212 168" fill={GOLD} opacity="0.5" />
              </>
            ) : (
              <>
                {[0, 1, 2].map((i) => (
                  <g key={i}>
                    <line x1="70" y1={64 + i * 36} x2="250" y2={64 + i * 36} stroke={COURT_LINE} strokeWidth="4" strokeLinecap="round" />
                    <circle cx={100 + i * 60} cy={64 + i * 36} r="10" fill={i === 1 ? GOLD : INK} />
                  </g>
                ))}
              </>
            )}
          </svg>
        )}

        {(kind === "code" ||
          kind === "screen" ||
          kind === "cloud" ||
          kind === "calendar" ||
          kind === "target" ||
          kind === "claim" ||
          kind === "scale") && (
          <svg viewBox="0 0 320 200" className="w-full h-full" role="img" aria-hidden>
            {kind === "code" &&
              [0, 1, 2, 3, 4, 5].map((i) => (
                <g key={i}>
                  <rect x={52 + i * 36} y="72" width="30" height="56" rx="7" fill={i % 2 ? INK : GOLD} opacity={i % 2 ? 0.08 : 0.9} />
                  <text x={67 + i * 36} y="108" textAnchor="middle" fontSize="18" fontWeight="700" fill={i % 2 ? INK : "#F7F5F2"} fontFamily="Space Grotesk, monospace">
                    {"7A4C2K"[i]}
                  </text>
                </g>
              ))}
            {kind === "screen" && (
              <>
                <rect x="76" y="44" width="168" height="104" rx="12" fill="none" stroke={COURT_LINE} strokeWidth="2.5" />
                <rect x="96" y="66" width="60" height="10" rx="5" fill={INK} opacity="0.5" />
                <rect x="96" y="86" width="120" height="10" rx="5" fill={GOLD} />
                <rect x="96" y="106" width="90" height="10" rx="5" fill={INK} opacity="0.2" />
                <rect x="140" y="156" width="40" height="6" rx="3" fill={COURT_LINE} />
              </>
            )}
            {kind === "cloud" && (
              <>
                <path
                  d="M112 124 A 26 26 0 0 1 138 92 A 32 32 0 0 1 200 88 A 24 24 0 0 1 206 124 Z"
                  fill="none"
                  stroke={COURT_LINE}
                  strokeWidth="2.5"
                />
                <line x1="132" y1="60" x2="188" y2="150" stroke={GOLD_INK} strokeWidth="2.5" strokeLinecap="round" />
                <rect x="128" y="140" width="64" height="10" rx="5" fill={GOLD} />
              </>
            )}
            {kind === "calendar" && (
              <>
                <rect x="86" y="52" width="148" height="112" rx="12" fill="none" stroke={COURT_LINE} strokeWidth="2.5" />
                <line x1="86" y1="82" x2="234" y2="82" stroke={COURT_LINE} strokeWidth="2" />
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <circle key={i} cx={110 + (i % 3) * 50} cy={104 + Math.floor(i / 3) * 34} r="9" fill={i === 1 ? GOLD : INK} opacity={i === 1 ? 1 : 0.12} />
                ))}
              </>
            )}
            {kind === "claim" && (
              <>
                <circle cx="146" cy="100" r="42" fill="none" stroke={COURT_LINE} strokeWidth="2.5" strokeDasharray="7 7" />
                <circle cx="146" cy="100" r="15" fill={INK} opacity="0.12" />
                <path d="M170 116 l16 18 l30 -44" fill="none" stroke={GOLD} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}
            {kind === "scale" && (
              <>
                <line x1="70" y1="72" x2="250" y2="72" stroke={GOLD} strokeWidth="6" strokeLinecap="round" />
                <line x1="160" y1="72" x2="160" y2="150" stroke={INK} strokeWidth="4" strokeLinecap="round" />
                <rect x="128" y="150" width="64" height="7" rx="3.5" fill={INK} />
                <path d="M74 76 L100 118 H48 Z" fill="none" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
                <path d="M246 76 L272 118 H220 Z" fill="none" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
                <circle cx="74" cy="102" r="9" fill={INK} />
                <rect x="237" y="93" width="18" height="18" rx="3" fill={INK} />
              </>
            )}
            {kind === "target" && (
              <>
                <circle cx="160" cy="100" r="60" fill="none" stroke={COURT_LINE} strokeWidth="2.5" />
                <circle cx="160" cy="100" r="34" fill="none" stroke={COURT_LINE} strokeWidth="2.5" />
                <circle cx="160" cy="100" r="12" fill={GOLD} />
                <text x="160" y="184" textAnchor="middle" fontSize="12" fontWeight="700" fill={GOLD_INK} fontFamily="Space Grotesk, monospace">
                  21
                </text>
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
