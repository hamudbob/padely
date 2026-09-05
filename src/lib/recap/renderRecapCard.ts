
/**
 * Renders the shareable session recap card ("Podium" design) to a 1080×1920
 * PNG on a canvas — story proportions, so it drops straight into WhatsApp
 * Status / Instagram Stories.
 *
 * Everything is drawn rather than screenshotted: html2canvas-style DOM capture
 * can't be trusted across browsers for conic gradients, cross-origin avatars and
 * webfont metrics, and this has to look identical for every host.
 */

export interface RecapPlayer {
  name: string;
  points: number;
  avatarUrl: string | null;
}

export interface RecapData {
  sessionName: string;
  /** Null for an ad-hoc session — the gold club line is then omitted. */
  clubName: string | null;
  /** ISO timestamp; the session's end (falls back to now at the call site). */
  date: string;
  formatLabel: string;
  playerCount: number;
  roundCount: number;
  /** Ranked best-first. 1–3 entries; fewer than 3 simply renders fewer plinths. */
  podium: RecapPlayer[];
  /** Public live-view URL encoded into the QR. */
  liveUrl: string;
}

const W = 1080;
const H = 1920;

const GOLD = "#BFA36A";
const GOLD_LT = "#DDBB72";
const GOLD_DP = "#8A6D33";
const IVORY = "#F7F5F2";

/** Webfonts must be resident before the canvas can measure or draw with them. */
async function ensureFonts(): Promise<void> {
  const faces = [
    '700 58px "Fraunces"',
    '700 52px "Fraunces"',
    '600 34px "Inter"',
    '700 27px "Inter"',
    '600 26px "Inter"',
    '700 46px "Space Grotesk"',
    '600 32px "Space Grotesk"',
    '600 36px "Lora"',
  ];
  try {
    await Promise.all(faces.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {
    /* Fall back to whatever is resident — layout still holds. */
  }
}

/** Cross-origin avatars need CORS to survive canvas export; failure is non-fatal. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    // Don't let one slow avatar hold up the whole card.
    setTimeout(() => resolve(img.complete && img.naturalWidth > 0 ? img : null), 4000);
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s&]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Canvas has no letter-spacing everywhere yet — space glyphs manually. */
function trackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  tracking: number,
) {
  const chars = [...text];
  const width = chars.reduce((sum, ch) => sum + ctx.measureText(ch).width + tracking, 0) - tracking;
  let x = cx - width / 2;
  for (const ch of chars) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + tracking;
  }
}

/** Shrink until it fits — a long name must never wrap or overflow its column. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  startPx: number,
  family: string,
  minPx = 20,
): number {
  let size = startPx;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > minPx) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

/** Wrap into at most `maxLines`, ellipsising the last one if needed. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (ctx.measureText(attempt).width <= maxWidth || !line) {
      line = attempt;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  name: string,
  cx: number,
  cy: number,
  radius: number,
  fallbackFontPx: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    // cover-fit, centred
    const scale = Math.max((radius * 2) / img.naturalWidth, (radius * 2) / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = "rgba(247,245,242,0.10)";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = "rgba(247,245,242,0.78)";
    ctx.font = `600 ${fallbackFontPx}px "Inter", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(name), cx, cy + 2);
  }
  ctx.restore();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    .toUpperCase();
}

export async function renderRecapCard(data: RecapData): Promise<Blob> {
  await ensureFonts();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable on this device.");

  const podium = data.podium.slice(0, 3);
  const avatars = await Promise.all(podium.map((p) => (p.avatarUrl ? loadImage(p.avatarUrl) : Promise.resolve(null))));

  // ── Background ─────────────────────────────────────────────────────────────
  ctx.fillStyle = "#0A0908";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 70, 0, W / 2, 70, 1180);
  glow.addColorStop(0, "#282419");
  glow.addColorStop(0.58, "#100E0B");
  glow.addColorStop(1, "#0A0908");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const PAD = 78;
  // Story chrome (profile row up top, reply bar at the bottom) eats roughly the
  // first and last 250px — every element below is kept inside that band.
  const SAFE_TOP = 250;
  ctx.textBaseline = "alphabetic";

  // ── Wordmark + date ────────────────────────────────────────────────────────
  ctx.textAlign = "left";
  ctx.font = '600 36px "Lora", Georgia, serif';
  ctx.fillStyle = IVORY;
  ctx.fillText("Padelier", PAD, SAFE_TOP + 60);
  const wmWidth = ctx.measureText("Padelier").width;
  ctx.beginPath();
  ctx.arc(PAD + wmWidth + 10, SAFE_TOP + 49, 6, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();

  ctx.textAlign = "right";
  ctx.font = '600 26px "Space Grotesk", monospace';
  ctx.fillStyle = "rgba(247,245,242,0.45)";
  ctx.fillText(formatDate(data.date), W - PAD, SAFE_TOP + 58);

  // ── Club + session + meta ──────────────────────────────────────────────────
  let y = SAFE_TOP + 142;
  ctx.textAlign = "center";
  if (data.clubName) {
    // Tracked caps grow fast — shrink until the whole line fits the margins.
    const club = data.clubName.toUpperCase();
    let clubSize = 27;
    let tracking = 5.4;
    const trackedWidth = () => {
      ctx.font = `700 ${clubSize}px "Inter", sans-serif`;
      return [...club].reduce((s, ch) => s + ctx.measureText(ch).width + tracking, 0) - tracking;
    };
    while (trackedWidth() > W - PAD * 2 && clubSize > 15) {
      clubSize -= 1;
      tracking = Math.max(1.6, tracking - 0.25);
    }
    ctx.fillStyle = GOLD;
    trackedText(ctx, club, W / 2, y, tracking);
    y += 58;
  }

  ctx.fillStyle = IVORY;
  const titleSize = data.sessionName.length > 26 ? 50 : 58;
  ctx.font = `700 ${titleSize}px "Fraunces", Georgia, serif`;
  const titleLines = wrap(ctx, data.sessionName, W - PAD * 2, 2);
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, y);
    y += titleSize * 1.12;
  }

  y += 8;
  ctx.font = '400 26px "Inter", sans-serif';
  ctx.fillStyle = "rgba(247,245,242,0.45)";
  const meta = [data.formatLabel, `${data.playerCount} players`, `${data.roundCount} rounds`]
    .filter(Boolean)
    .join(" · ");
  ctx.fillText(meta, W / 2, y);

  // ── Podium ─────────────────────────────────────────────────────────────────
  // Plinth tops are anchored to a common baseline so the bars tell the story.
  const BASE = 1290;
  // Column geometry in podium order (2 · 1 · 3). With fewer than three ranked
  // players the remaining plinths are re-centred, so a small session doesn't
  // render visibly lopsided.
  type Col = { rank: number; cx: number; avatar: number; plinth: number; wide: number };
  const CHAMP = { rank: 1, avatar: 92, plinth: 310, wide: 286 };
  const SECOND = { rank: 2, avatar: 66, plinth: 200, wide: 246 };
  const THIRD = { rank: 3, avatar: 66, plinth: 152, wide: 246 };
  const GAP = 50;

  let cols: Col[];
  if (podium.length >= 3) {
    cols = [
      { ...SECOND, cx: W / 2 - 298 },
      { ...CHAMP, cx: W / 2 },
      { ...THIRD, cx: W / 2 + 298 },
    ];
  } else if (podium.length === 2) {
    const total = SECOND.wide + GAP + CHAMP.wide;
    const left = W / 2 - total / 2;
    cols = [
      { ...SECOND, cx: left + SECOND.wide / 2 },
      { ...CHAMP, cx: left + SECOND.wide + GAP + CHAMP.wide / 2 },
    ];
  } else {
    cols = [{ ...CHAMP, cx: W / 2 }];
  }

  for (const col of cols) {
    const idx = col.rank - 1;
    const player = podium[idx];
    if (!player) continue;
    const img = avatars[idx] ?? null;
    const isChampion = col.rank === 1;
    const plinthTop = BASE - col.plinth;

    // Plinth
    roundRect(ctx, col.cx - col.wide / 2, plinthTop, col.wide, col.plinth + 40, 22);
    if (isChampion) {
      const g = ctx.createLinearGradient(0, plinthTop, 0, BASE);
      g.addColorStop(0, "rgba(191,163,106,0.34)");
      g.addColorStop(1, "rgba(191,163,106,0.06)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(191,163,106,0.30)";
    } else {
      ctx.fillStyle = "rgba(247,245,242,0.075)";
      ctx.fill();
      ctx.strokeStyle = "rgba(247,245,242,0.09)";
    }
    ctx.lineWidth = 2;
    ctx.stroke();

    // Rank numeral (and CHAMPION under the winner's)
    ctx.textAlign = "center";
    ctx.font = `700 ${isChampion ? 46 : 40}px "Space Grotesk", monospace`;
    ctx.fillStyle = isChampion ? GOLD_LT : "rgba(247,245,242,0.32)";
    ctx.fillText(String(col.rank), col.cx, plinthTop + (isChampion ? 68 : 60));
    if (isChampion) {
      ctx.font = '700 21px "Inter", sans-serif';
      ctx.fillStyle = "rgba(191,163,106,0.85)";
      trackedText(ctx, "CHAMPION", col.cx, plinthTop + 104, 4.2);
    }

    // Points
    const ptsY = plinthTop - 30;
    ctx.font = `${isChampion ? 700 : 600} ${isChampion ? 38 : 32}px "Space Grotesk", monospace`;
    ctx.fillStyle = GOLD_LT;
    ctx.textAlign = "center";
    ctx.fillText(String(player.points), col.cx, ptsY);

    // Name — auto-shrinks rather than wrapping
    const nameY = ptsY - (isChampion ? 46 : 40);
    const family = isChampion ? '"Fraunces", Georgia, serif' : '"Inter", sans-serif';
    const size = fitFont(ctx, player.name, col.wide - 16, isChampion ? 700 : 600, isChampion ? 52 : 34, family, 22);
    ctx.font = `${isChampion ? 700 : 600} ${size}px ${family}`;
    ctx.fillStyle = IVORY;
    ctx.fillText(player.name, col.cx, nameY);

    // Avatar — champion wears a gold ring
    const avCy = nameY - (isChampion ? 40 : 30) - col.avatar;
    if (isChampion) {
      const ring = ctx.createLinearGradient(col.cx - col.avatar, avCy - col.avatar, col.cx + col.avatar, avCy + col.avatar);
      ring.addColorStop(0, GOLD);
      ring.addColorStop(0.45, "#F0DFAE");
      ring.addColorStop(0.75, GOLD_DP);
      ring.addColorStop(1, GOLD);
      ctx.beginPath();
      ctx.arc(col.cx, avCy, col.avatar + 11, 0, Math.PI * 2);
      ctx.fillStyle = ring;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(col.cx, avCy, col.avatar + 5, 0, Math.PI * 2);
      ctx.fillStyle = "#14120E";
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(col.cx, avCy, col.avatar + 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(247,245,242,0.18)";
      ctx.fill();
    }
    drawAvatar(ctx, img, player.name, col.cx, avCy, col.avatar, isChampion ? 56 : 42);
  }

  // ── Divider ────────────────────────────────────────────────────────────────
  const hairY = 1400;
  const hair = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  hair.addColorStop(0, "rgba(191,163,106,0)");
  hair.addColorStop(0.5, "rgba(191,163,106,0.55)");
  hair.addColorStop(1, "rgba(191,163,106,0)");
  ctx.fillStyle = hair;
  ctx.fillRect(PAD, hairY, W - PAD * 2, 2);

  // ── Call to action ─────────────────────────────────────────────────────────
  //
  // THERE WAS A QR CODE HERE, and it did not scan. Two reasons, both from the
  // same cause — it was drawn too small to survive being photographed off a
  // phone screen. At 196px including a 20px quiet zone, a version-5 code left
  // modules under 5px, and the +0.6px overdraw that closed the hairline seams
  // between cells also bled dark modules into light ones. A recap gets shared
  // to WhatsApp, which recompresses it, and by then there was nothing left to
  // decode.
  //
  // It could have been rescued — a bigger box, error correction at Q or H, no
  // overdraw — but a QR aimed at a live session has a short life anyway, and a
  // code that fails once teaches people not to try again. The wordmark is a
  // promise the card can keep. (lib/recap/qr.ts is now unused; it is in git
  // history if this ever comes back.)
  const ctaY = 1500;
  ctx.textAlign = "left";
  ctx.font = '600 34px "Inter", sans-serif';
  ctx.fillStyle = IVORY;
  ctx.fillText("Watch it back", PAD, ctaY);

  ctx.font = '400 26px "Inter", sans-serif';
  ctx.fillStyle = "rgba(247,245,242,0.5)";
  const sub = wrap(ctx, "Full standings and every round on padelier.id", W - PAD * 2, 2);
  let sy = ctaY + 46;
  for (const line of sub) {
    ctx.fillText(line, PAD, sy);
    sy += 36;
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not export the image."))),
      "image/png",
    );
  });
}
