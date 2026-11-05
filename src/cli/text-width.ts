import { WIDE_RANGES, ZERO_WIDTH_RANGES } from "./text-width-ranges";

const NON_ASCII_RUN_RE = /[^\x20-\x7e]+/g;
const EMOJI_START_RE = /^\p{Emoji}/u;
const FLAG_RE = /^\p{Regional_Indicator}{2}$/u;
const EMOJI_PRESENTATION = 0xfe0f;
const KEYCAP = 0x20e3;
const ZERO_WIDTH_JOINER = 0x200d;
const SKIN_TONES = [0x1f3fb, 0x1f3ff] as const;
const TAGS = [0xe0020, 0xe007f] as const;
const TEXT_PRESENTATION = "\u{fe0e}";
const KHMER_SIGN_BEYYAL = 0x17d8;
const LAM = 0x644;
const ALEFS: ReadonlySet<number> = new Set([0x622, 0x623, 0x625, 0x627]);
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function inRanges(ranges: readonly number[], codePoint: number): boolean {
  let low = 0;
  let high = ranges.length / 2 - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (codePoint < ranges[2 * middle]) {
      high = middle - 1;
    } else if (codePoint > ranges[2 * middle + 1]) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

function continuesEmoji(codePoint: number): boolean {
  return (
    codePoint === EMOJI_PRESENTATION ||
    codePoint === KEYCAP ||
    codePoint === ZERO_WIDTH_JOINER ||
    inRanges(SKIN_TONES, codePoint) ||
    inRanges(TAGS, codePoint)
  );
}

function codePointWidth(codePoint: number): number {
  if (codePoint === KHMER_SIGN_BEYYAL) {
    return 3;
  }
  if (inRanges(ZERO_WIDTH_RANGES, codePoint)) {
    return 0;
  }
  return inRanges(WIDE_RANGES, codePoint) ? 2 : 1;
}

function clusterWidth(cluster: string): number {
  const codePoints = Array.from(cluster, (character) =>
    character.codePointAt(0),
  ).filter((codePoint) => codePoint !== undefined);
  if (codePoints.length > 1 && FLAG_RE.test(cluster)) {
    return 2;
  }
  if (codePoints.length > 1 && EMOJI_START_RE.test(cluster)) {
    if (cluster.includes(TEXT_PRESENTATION)) {
      return 1;
    }
    if (codePoints.some(continuesEmoji)) {
      return 2;
    }
  }
  return codePoints.reduce(
    (columns, codePoint) => columns + codePointWidth(codePoint),
    0,
  );
}

function clustersWidth(text: string): number {
  let columns = 0;
  let afterLam = false;
  for (const { segment } of GRAPHEMES.segment(text)) {
    const first = segment.codePointAt(0) ?? 0;
    columns += clusterWidth(segment) - (afterLam && ALEFS.has(first) ? 1 : 0);
    afterLam = segment.codePointAt(segment.length - 1) === LAM;
  }
  return columns;
}

/**
 * Columns `text` takes as oxfmt counts them: emoji sequences, flags and
 * keycaps as two, a lam-alef ligature as one, other grapheme clusters as the
 * sum of their code points' widths. Only runs of non-ASCII text, with the
 * character before each run as a possible base, are split into clusters.
 */
export function textWidth(text: string): number {
  let columns = text.length;
  for (const run of text.matchAll(NON_ASCII_RUN_RE)) {
    const start = Math.max(run.index - 1, 0);
    const cluster = text.slice(start, run.index + run[0].length);
    columns += clustersWidth(cluster) - cluster.length;
  }
  return columns;
}
