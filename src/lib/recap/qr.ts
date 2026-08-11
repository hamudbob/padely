/**
 * Minimal QR Code encoder — byte mode, versions 1–10, EC levels L/M/Q/H.
 *
 * Written in-house rather than pulled from npm so the recap card has zero new
 * runtime dependencies and the build can be verified offline. Scope is
 * deliberately narrow: we only ever encode a short https URL (the session's
 * public live-view link), which fits comfortably inside version 10 at EC level
 * M. Anything longer throws rather than silently producing an unscannable code.
 *
 * Implements ISO/IEC 18004: Reed–Solomon over GF(256), block interleaving,
 * function-pattern placement, all eight data masks with the four penalty rules,
 * and BCH-protected format/version information.
 */

export type EcLevel = "L" | "M" | "Q" | "H";

/** Total codewords (data + error correction) per version. Index = version. */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/**
 * Per version + EC level: [ecCodewordsPerBlock, group1Blocks, group1DataCodewords,
 * group2Blocks, group2DataCodewords]. Group 2 blocks hold one extra codeword.
 */
const BLOCKS: Record<number, Record<EcLevel, [number, number, number, number, number]>> = {
  1:  { L: [7, 1, 19, 0, 0],    M: [10, 1, 16, 0, 0],   Q: [13, 1, 13, 0, 0],   H: [17, 1, 9, 0, 0] },
  2:  { L: [10, 1, 34, 0, 0],   M: [16, 1, 28, 0, 0],   Q: [22, 1, 22, 0, 0],   H: [28, 1, 16, 0, 0] },
  3:  { L: [15, 1, 55, 0, 0],   M: [26, 1, 44, 0, 0],   Q: [18, 2, 17, 0, 0],   H: [22, 2, 13, 0, 0] },
  4:  { L: [20, 1, 80, 0, 0],   M: [18, 2, 32, 0, 0],   Q: [26, 2, 24, 0, 0],   H: [16, 4, 9, 0, 0] },
  5:  { L: [26, 1, 108, 0, 0],  M: [24, 2, 43, 0, 0],   Q: [18, 2, 15, 2, 16],  H: [22, 2, 11, 2, 12] },
  6:  { L: [18, 2, 68, 0, 0],   M: [16, 4, 27, 0, 0],   Q: [24, 4, 19, 0, 0],   H: [28, 4, 15, 0, 0] },
  7:  { L: [20, 2, 78, 0, 0],   M: [18, 4, 31, 0, 0],   Q: [18, 2, 14, 4, 15],  H: [26, 4, 13, 1, 14] },
  8:  { L: [24, 2, 97, 0, 0],   M: [22, 2, 38, 2, 39],  Q: [22, 4, 18, 2, 19],  H: [26, 4, 14, 2, 15] },
  9:  { L: [30, 2, 116, 0, 0],  M: [22, 3, 36, 2, 37],  Q: [20, 4, 16, 4, 17],  H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69],  M: [26, 4, 43, 1, 44],  Q: [24, 6, 19, 2, 20],  H: [28, 6, 15, 2, 16] },
};

/** Alignment-pattern centre coordinates per version. */
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Two-bit EC level indicator used inside the format information. */
const EC_BITS: Record<EcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

// ── GF(256), primitive polynomial 0x11D ──────────────────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Reed–Solomon generator polynomial of the given degree. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let d = 0; d < degree; d++) {
    const next = new Uint8Array(poly.length + 1);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

/** EC codewords for one data block. */
function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

// ── Bit buffer ───────────────────────────────────────────────────────────────
class Bits {
  readonly bits: number[] = [];
  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

/** The eight data-mask predicates. True means "flip this module". */
function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return ((((row + col) % 2) + ((row * col) % 3)) % 2) === 0;
  }
}

export interface QrMatrix {
  size: number;
  /** Row-major; true = dark. */
  modules: boolean[][];
  version: number;
}

/**
 * Encode `text` (UTF-8, byte mode) into a QR matrix.
 * Throws if the payload doesn't fit in version 10 at the requested EC level.
 */
export function encodeQr(text: string, ecLevel: EcLevel = "M"): QrMatrix {
  const bytes = new TextEncoder().encode(text);

  // Smallest version that fits. Character-count field is 8 bits below v10.
  let version = 0;
  let spec: [number, number, number, number, number] | null = null;
  for (let v = 1; v <= 10; v++) {
    const s = BLOCKS[v][ecLevel];
    const dataCodewords = s[1] * s[2] + s[3] * s[4];
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords * 8) {
      version = v;
      spec = s;
      break;
    }
  }
  if (!version || !spec) throw new Error("QR payload too long for version 10.");

  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = spec;
  const dataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;

  // ── Bit stream: mode + length + payload + terminator + padding ─────────────
  const bb = new Bits();
  bb.put(0b0100, 4);
  bb.put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) bb.put(b, 8);
  const capacityBits = dataCodewords * 8;
  bb.put(0, Math.min(4, capacityBits - bb.length));
  while (bb.length % 8 !== 0) bb.bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bb.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bb.bits[i + k];
    words.push(v);
  }
  for (let pad = 0; words.length < dataCodewords; pad++) words.push(pad % 2 === 0 ? 0xec : 0x11);

  // ── Split into blocks, compute EC, interleave ──────────────────────────────
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks + g2Blocks; i++) {
    const len = i < g1Blocks ? g1Data : g2Data;
    const block = new Uint8Array(words.slice(offset, offset + len));
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }
  const final: number[] = [];
  const maxData = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) final.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) final.push(block[i]);
  }

  const bitStream: number[] = [];
  for (const word of final) for (let i = 7; i >= 0; i--) bitStream.push((word >>> i) & 1);

  // ── Function patterns ──────────────────────────────────────────────────────
  const size = version * 4 + 17;
  const m: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const put = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    m[r][c] = dark ? 1 : 0;
    fn[r][c] = true;
  };

  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const ring = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        put(r0 + r, c0 + c, ring || core);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 0; i < size; i++) {
    if (!fn[6][i]) put(6, i, i % 2 === 0);
    if (!fn[i][6]) put(i, 6, i % 2 === 0);
  }

  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      // Skip centres that would collide with a finder pattern.
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          put(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  put(size - 8, 8, true); // the always-dark module

  // Reserve (but don't yet write) the format areas.
  const reserve = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= size || c >= size || fn[r][c]) return;
    fn[r][c] = true;
    m[r][c] = 0;
  };
  for (let i = 0; i < 9; i++) { reserve(8, i); reserve(i, 8); }
  for (let i = 0; i < 8; i++) { reserve(8, size - 1 - i); reserve(size - 1 - i, 8); }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = i % 3;
      reserve(size - 11 + b, a);
      reserve(a, size - 11 + b);
    }
  }

  // ── Data placement: two-module columns, right to left, zigzag ──────────────
  const placeData = (mask: number): number[][] => {
    const grid = m.map((row) => row.slice());
    let idx = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // the vertical timing column is never a data column
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const c = col - k;
          if (fn[row][c]) continue;
          let bit = idx < bitStream.length ? bitStream[idx++] : 0;
          if (maskAt(mask, row, c)) bit ^= 1;
          grid[row][c] = bit;
        }
      }
      upward = !upward;
    }
    return grid;
  };

  const writeFormat = (grid: number[][], mask: number) => {
    const data = (EC_BITS[ecLevel] << 3) | mask;
    let rem = data << 10;
    for (let i = 4; i >= 0; i--) if ((rem >>> (i + 10)) & 1) rem ^= 0x537 << i;
    const fmt = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((fmt >>> i) & 1);

    for (let i = 0; i <= 5; i++) grid[8][i] = bit(i);
    grid[8][7] = bit(6);
    grid[8][8] = bit(7);
    grid[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) grid[14 - i][8] = bit(i);

    for (let i = 0; i < 7; i++) grid[size - 1 - i][8] = bit(i);
    for (let i = 7; i < 15; i++) grid[8][size - 15 + i] = bit(i);

    grid[size - 8][8] = 1; // dark module survives format writing

    if (version >= 7) {
      let vrem = version << 12;
      for (let i = 5; i >= 0; i--) if ((vrem >>> (i + 12)) & 1) vrem ^= 0x1f25 << i;
      const vinfo = (version << 12) | vrem;
      for (let i = 0; i < 18; i++) {
        const b = (vinfo >>> i) & 1;
        const a = Math.floor(i / 3);
        const c = i % 3;
        grid[size - 11 + c][a] = b;
        grid[a][size - 11 + c] = b;
      }
    }
  };

  // ── Mask selection by penalty score ────────────────────────────────────────
  const penalty = (g: number[][]): number => {
    let score = 0;

    // Rule 1 — runs of five or more same-coloured modules in a line.
    for (let i = 0; i < size; i++) {
      let runR = 1, runC = 1;
      for (let j = 1; j < size; j++) {
        runR = g[i][j] === g[i][j - 1] ? runR + 1 : 1;
        if (runR === 5) score += 3; else if (runR > 5) score += 1;
        runC = g[j][i] === g[j - 1][i] ? runC + 1 : 1;
        if (runC === 5) score += 3; else if (runC > 5) score += 1;
      }
    }

    // Rule 2 — 2×2 blocks of one colour.
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = g[r][c];
        if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3 — finder-like 1:1:3:1:1 patterns with four light modules either side.
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matches = (get: (i: number) => number, start: number, pat: number[]) => {
      for (let k = 0; k < 11; k++) if (get(start + k) !== pat[k]) return false;
      return true;
    };
    for (let i = 0; i < size; i++) {
      for (let j = 0; j <= size - 11; j++) {
        if (matches((k) => g[i][k], j, A) || matches((k) => g[i][k], j, B)) score += 40;
        if (matches((k) => g[k][i], j, A) || matches((k) => g[k][i], j, B)) score += 40;
      }
    }

    // Rule 4 — deviation from a 50 % dark ratio.
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += g[r][c];
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  };

  let best: number[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = placeData(mask);
    writeFormat(grid, mask);
    const s = penalty(grid);
    if (s < bestScore) {
      bestScore = s;
      best = grid;
    }
  }

  return {
    size,
    version,
    modules: (best as number[][]).map((row) => row.map((v) => v === 1)),
  };
}
