import {
  SPECIAL_RANGES,
  WIDE_RANGES,
  ZERO_WIDTH_RANGES,
} from "./text-width-ranges";
import {
  EMOJI_MODIFIER_BASE_RANGES,
  EMOJI_SEQUENCE_START_RANGES,
  NON_TRANSPARENT_ZERO_WIDTH_RANGES,
  TEXT_SEQUENCE_START_RANGES,
} from "./text-width-sequences";

const PRINTABLE_ASCII_RE = /^[\x20-\x7e]*$/;

const DEFAULT = 0;
const LINE_FEED = 0b1;
const EMOJI_MODIFIER = 0b10;
const REGIONAL_INDICATOR = 0b11;
const SEVERAL_REGIONAL_INDICATOR = 0b100;
const EMOJI_PRESENTATION = 0b101;
const ZWJ_EMOJI_PRESENTATION = 0b0001_0000_0000_0110;
const VS16_ZWJ_EMOJI_PRESENTATION = 0b1001_0000_0000_0110;
const KEYCAP_ZWJ_EMOJI_PRESENTATION = 0b0001_0000_0000_0111;
const VS16_KEYCAP_ZWJ_EMOJI_PRESENTATION = 0b1001_0000_0000_0111;
const REGIONAL_INDICATOR_ZWJ_PRESENTATION = 0b1001;
const EVEN_REGIONAL_INDICATOR_ZWJ_PRESENTATION = 0b1010;
const ODD_REGIONAL_INDICATOR_ZWJ_PRESENTATION = 0b1011;
const TAG_END_ZWJ_EMOJI_PRESENTATION = 0b1_0000;
const TAG_D1_END_ZWJ_EMOJI_PRESENTATION = 0b1_0001;
const TAG_D2_END_ZWJ_EMOJI_PRESENTATION = 0b1_0010;
const TAG_D3_END_ZWJ_EMOJI_PRESENTATION = 0b1_0011;
const TAG_A1_END_ZWJ_EMOJI_PRESENTATION = 0b1_1001;
const TAG_A2_END_ZWJ_EMOJI_PRESENTATION = 0b1_1010;
const TAG_A3_END_ZWJ_EMOJI_PRESENTATION = 0b1_1011;
const TAG_A4_END_ZWJ_EMOJI_PRESENTATION = 0b1_1100;
const TAG_A5_END_ZWJ_EMOJI_PRESENTATION = 0b1_1101;
const TAG_A6_END_ZWJ_EMOJI_PRESENTATION = 0b1_1110;
const KIRAT_RAI_VOWEL_SIGN_E = 0b10_0000;
const KIRAT_RAI_VOWEL_SIGN_AI = 0b10_0001;
const VARIATION_SELECTOR_1_2_OR_3 = 0b0000_0010_0000_0000;
const VARIATION_SELECTOR_15 = 0b0100_0000_0000_0000;
const VARIATION_SELECTOR_16 = 0b1000_0000_0000_0000;
const JOINING_GROUP_ALEF = 0b0011_0000_1111_1111;
const HEBREW_LETTER_LAMED = 0b0011_1000_0000_0000;
const ZWJ_HEBREW_LETTER_LAMED = 0b0011_1100_0000_0000;
const BUGINESE_LETTER_YA = 0b0011_1000_0000_0001;
const ZWJ_BUGINESE_LETTER_YA = 0b0011_1100_0000_0001;
const BUGINESE_VOWEL_SIGN_I_ZWJ_LETTER_YA = 0b0011_1100_0000_0010;
const TIFINAGH_CONSONANT = 0b0011_1000_0000_0011;
const ZWJ_TIFINAGH_CONSONANT = 0b0011_1100_0000_0011;
const TIFINAGH_JOINER_CONSONANT = 0b0011_1100_0000_0100;
const LISU_TONE_LETTER_MYA_NA_JEU = 0b0011_1100_0000_0101;
const OLD_TURKIC_LETTER_ORKHON_I = 0b0011_1000_0000_0110;
const ZWJ_OLD_TURKIC_LETTER_ORKHON_I = 0b0011_1100_0000_0110;
const KHMER_COENG_ELIGIBLE_LETTER = 0b0011_1100_0000_0111;

const LIGATURE_TRANSPARENT_MASK = 0b0010_0000_0000_0000;
const LIGATURE_TRANSPARENT_BIT = 0b0000_1000_0000_0000;
const ZWJ_BIT = 0b0000_0100_0000_0000;
const ZWJ_PRESENTATION_MASK = 0b1011_0000_0000_0000;
const VS16_ZWJ_MASK = 0b1001_0000_0000_0000;
const ZWJ_ONLY_BITS = 0b0001_0000_0000_0000;

const ZWJ = 0x200d;
const KEYCAP = 0x20e3;
const VS1 = 0xfe01;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const COENG = 0x17d2;
const QUOTATION_MARKS: ReadonlySet<number> = new Set([
  0x2018, 0x2019, 0x201c, 0x201d,
]);
const LIGATURE_TRANSPARENT = [
  0x34f, 0x34f, 0x17b4, 0x17b5, 0x180b, 0x180d, 0x180f, 0x180f, 0x200d, 0x200d,
  0xfe00, 0xfe0f, 0xe0100, 0xe01ef,
];
const LAMS = [
  0x644, 0x644, 0x6b5, 0x6b8, 0x76a, 0x76a, 0x8a6, 0x8a6, 0x8c7, 0x8c7,
];
const REGIONAL_INDICATORS = [0x1f1e6, 0x1f1ff];
const EMOJI_MODIFIERS = [0x1f3fb, 0x1f3ff];
const TAG_LETTERS = [0xe0061, 0xe007a];
const TAG_DIGITS = [0xe0030, 0xe0039];
const TAG_CANCEL = 0xe007f;
const BLACK_FLAG = 0x1f3f4;
const KEYCAP_BASES = [0x23, 0x23, 0x2a, 0x2a, 0x30, 0x39];
const TIFINAGH_LETTERS = [0x2d31, 0x2d65, 0x2d6f, 0x2d6f];
const TIFINAGH_JOINER = 0x2d7f;
const LISU_TONES = [0xa4f8, 0xa4fb];

/** The width a code point adds, and the state it leaves for the one before it. */
type Step = readonly [columns: number, info: number];

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

function between(codePoint: number, first: number, last: number): boolean {
  return codePoint >= first && codePoint <= last;
}

function specialWidth(codePoint: number): Step {
  if (codePoint === 0xa) return [1, LINE_FEED];
  if (codePoint === 0x5dc) return [1, HEBREW_LETTER_LAMED];
  if (between(codePoint, 0x622, 0x882)) return [1, JOINING_GROUP_ALEF];
  if (between(codePoint, 0x1780, 0x17af)) {
    return [1, KHMER_COENG_ELIGIBLE_LETTER];
  }
  if (codePoint === 0x17d8) return [3, DEFAULT];
  if (codePoint === 0x1a10) return [1, BUGINESE_LETTER_YA];
  if (between(codePoint, 0x2d31, 0x2d6f)) return [1, TIFINAGH_CONSONANT];
  if (between(codePoint, 0xa4fc, 0xa4fd)) {
    return [1, LISU_TONE_LETTER_MYA_NA_JEU];
  }
  if (codePoint === VS1) return [0, VARIATION_SELECTOR_1_2_OR_3];
  if (codePoint === VS15) return [0, VARIATION_SELECTOR_15];
  if (codePoint === VS16) return [0, VARIATION_SELECTOR_16];
  if (codePoint === 0x10c03) return [1, OLD_TURKIC_LETTER_ORKHON_I];
  if (codePoint === 0x16d67) return [1, KIRAT_RAI_VOWEL_SIGN_E];
  if (codePoint === 0x16d68) return [1, KIRAT_RAI_VOWEL_SIGN_AI];
  if (inRanges(REGIONAL_INDICATORS, codePoint)) return [1, REGIONAL_INDICATOR];
  if (inRanges(EMOJI_MODIFIERS, codePoint)) return [2, EMOJI_MODIFIER];
  return [2, EMOJI_PRESENTATION];
}

function lookupWidth(codePoint: number): Step {
  if (inRanges(SPECIAL_RANGES, codePoint)) return specialWidth(codePoint);
  if (inRanges(ZERO_WIDTH_RANGES, codePoint)) return [0, DEFAULT];
  return [inRanges(WIDE_RANGES, codePoint) ? 2 : 1, DEFAULT];
}

function startsEmojiSequence(codePoint: number): boolean {
  return inRanges(EMOJI_SEQUENCE_START_RANGES, codePoint);
}

function isTransparentZeroWidth(codePoint: number): boolean {
  return (
    lookupWidth(codePoint)[0] === 0 &&
    !inRanges(NON_TRANSPARENT_ZERO_WIDTH_RANGES, codePoint)
  );
}

function setEmojiPresentation(info: number): number {
  const keepsState =
    (info & LIGATURE_TRANSPARENT_MASK) === LIGATURE_TRANSPARENT_MASK ||
    (info & VS16_ZWJ_MASK) === ZWJ_ONLY_BITS;
  return keepsState ? info | VARIATION_SELECTOR_16 : VARIATION_SELECTOR_16;
}

function setSelector(info: number, selector: number): number {
  return (info & LIGATURE_TRANSPARENT_MASK) === LIGATURE_TRANSPARENT_MASK
    ? info | selector
    : selector;
}

function hasBits(info: number, bits: number): boolean {
  return (info & bits) === bits;
}

function unsetEmojiPresentation(info: number): number {
  return hasBits(info, LIGATURE_TRANSPARENT_MASK)
    ? info & ~VARIATION_SELECTOR_16
    : DEFAULT;
}

/** A finished step, or the state the rest of the match reads. */
interface Selected {
  readonly step?: Step;
  readonly info: number;
}

/** The step a variation selector or ZWJ takes, or the state left for the match. */
function selectorStep(codePoint: number, info: number): Selected {
  if (codePoint === VS16)
    return { step: [0, setEmojiPresentation(info)], info };
  if (codePoint === VS1) {
    return { step: [0, setSelector(info, VARIATION_SELECTOR_1_2_OR_3)], info };
  }
  if (codePoint === VS15) {
    return { step: [0, setSelector(info, VARIATION_SELECTOR_15)], info };
  }
  let next = info;
  if (hasBits(next, VARIATION_SELECTOR_15)) {
    if (inRanges(TEXT_SEQUENCE_START_RANGES, codePoint)) {
      return { step: [1, DEFAULT], info };
    }
    next &= ~VARIATION_SELECTOR_15;
  } else if (hasBits(next, VARIATION_SELECTOR_1_2_OR_3)) {
    if (QUOTATION_MARKS.has(codePoint)) return { step: [2, DEFAULT], info };
    next &= ~VARIATION_SELECTOR_1_2_OR_3;
  }
  if (hasBits(next, LIGATURE_TRANSPARENT_BIT)) {
    if (codePoint === ZWJ) return { step: [0, next | ZWJ_BIT], info: next };
    if (inRanges(LIGATURE_TRANSPARENT, codePoint)) {
      return { step: [0, next], info: next };
    }
  }
  return { info: next };
}

function ligatureStep(codePoint: number, info: number): Step | undefined {
  if (info === JOINING_GROUP_ALEF) {
    if (inRanges(LAMS, codePoint)) return [0, DEFAULT];
    if (isTransparentZeroWidth(codePoint)) return [0, JOINING_GROUP_ALEF];
  }
  if (info === ZWJ_HEBREW_LETTER_LAMED && codePoint === 0x5d0) {
    return [0, DEFAULT];
  }
  if (info === KHMER_COENG_ELIGIBLE_LETTER && codePoint === COENG) {
    return [-1, DEFAULT];
  }
  if (info === ZWJ_BUGINESE_LETTER_YA && codePoint === 0x1a17) {
    return [0, BUGINESE_VOWEL_SIGN_I_ZWJ_LETTER_YA];
  }
  if (info === BUGINESE_VOWEL_SIGN_I_ZWJ_LETTER_YA && codePoint === 0x1a15) {
    return [0, DEFAULT];
  }
  return undefined;
}

function scriptLigatureStep(codePoint: number, info: number): Step | undefined {
  const tifinagh =
    info === TIFINAGH_CONSONANT || info === ZWJ_TIFINAGH_CONSONANT;
  if (tifinagh && codePoint === TIFINAGH_JOINER) {
    return [1, TIFINAGH_JOINER_CONSONANT];
  }
  if (inRanges(TIFINAGH_LETTERS, codePoint)) {
    if (info === ZWJ_TIFINAGH_CONSONANT) return [0, DEFAULT];
    if (info === TIFINAGH_JOINER_CONSONANT) return [-1, DEFAULT];
  }
  if (info === LISU_TONE_LETTER_MYA_NA_JEU && inRanges(LISU_TONES, codePoint)) {
    return [0, DEFAULT];
  }
  if (info === ZWJ_OLD_TURKIC_LETTER_ORKHON_I && codePoint === 0x10c32) {
    return [0, DEFAULT];
  }
  return undefined;
}

function regionalIndicatorStep(info: number): Step | undefined {
  if (info === REGIONAL_INDICATOR || info === SEVERAL_REGIONAL_INDICATOR) {
    return [1, SEVERAL_REGIONAL_INDICATOR];
  }
  if (info === ZWJ_EMOJI_PRESENTATION) {
    return [1, REGIONAL_INDICATOR_ZWJ_PRESENTATION];
  }
  if (
    info === REGIONAL_INDICATOR_ZWJ_PRESENTATION ||
    info === ODD_REGIONAL_INDICATOR_ZWJ_PRESENTATION
  ) {
    return [-1, EVEN_REGIONAL_INDICATOR_ZWJ_PRESENTATION];
  }
  if (info === EVEN_REGIONAL_INDICATOR_ZWJ_PRESENTATION) {
    return [3, ODD_REGIONAL_INDICATOR_ZWJ_PRESENTATION];
  }
  return undefined;
}

const TAG_LETTER_STATES: ReadonlyMap<number, number> = new Map([
  [TAG_END_ZWJ_EMOJI_PRESENTATION, TAG_A1_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A1_END_ZWJ_EMOJI_PRESENTATION, TAG_A2_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A2_END_ZWJ_EMOJI_PRESENTATION, TAG_A3_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A3_END_ZWJ_EMOJI_PRESENTATION, TAG_A4_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A4_END_ZWJ_EMOJI_PRESENTATION, TAG_A5_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A5_END_ZWJ_EMOJI_PRESENTATION, TAG_A6_END_ZWJ_EMOJI_PRESENTATION],
]);
const TAG_DIGIT_STATES: ReadonlyMap<number, number> = new Map([
  [TAG_END_ZWJ_EMOJI_PRESENTATION, TAG_D1_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A1_END_ZWJ_EMOJI_PRESENTATION, TAG_D1_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A2_END_ZWJ_EMOJI_PRESENTATION, TAG_D1_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A3_END_ZWJ_EMOJI_PRESENTATION, TAG_D1_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_A4_END_ZWJ_EMOJI_PRESENTATION, TAG_D1_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_D1_END_ZWJ_EMOJI_PRESENTATION, TAG_D2_END_ZWJ_EMOJI_PRESENTATION],
  [TAG_D2_END_ZWJ_EMOJI_PRESENTATION, TAG_D3_END_ZWJ_EMOJI_PRESENTATION],
]);
const TAG_FLAG_STATES: ReadonlySet<number> = new Set([
  TAG_A3_END_ZWJ_EMOJI_PRESENTATION,
  TAG_A4_END_ZWJ_EMOJI_PRESENTATION,
  TAG_A5_END_ZWJ_EMOJI_PRESENTATION,
  TAG_A6_END_ZWJ_EMOJI_PRESENTATION,
  TAG_D3_END_ZWJ_EMOJI_PRESENTATION,
]);
const ZWJ_JOINABLE: ReadonlySet<number> = new Set([
  EMOJI_PRESENTATION,
  SEVERAL_REGIONAL_INDICATOR,
  EVEN_REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  ODD_REGIONAL_INDICATOR_ZWJ_PRESENTATION,
  EMOJI_MODIFIER,
]);

function tagStep(codePoint: number, info: number): Step | undefined {
  if (inRanges(TAG_LETTERS, codePoint)) {
    const next = TAG_LETTER_STATES.get(info);
    if (next !== undefined) return [0, next];
  }
  if (inRanges(TAG_DIGITS, codePoint)) {
    const next = TAG_DIGIT_STATES.get(info);
    if (next !== undefined) return [0, next];
  }
  if (codePoint === BLACK_FLAG && TAG_FLAG_STATES.has(info)) {
    return [0, EMOJI_PRESENTATION];
  }
  return undefined;
}

function emojiStep(codePoint: number, info: number): Step | undefined {
  if (
    info === EMOJI_MODIFIER &&
    inRanges(EMOJI_MODIFIER_BASE_RANGES, codePoint)
  ) {
    return [0, EMOJI_PRESENTATION];
  }
  if (inRanges(REGIONAL_INDICATORS, codePoint)) {
    const step = regionalIndicatorStep(info);
    if (step !== undefined) return step;
  }
  if (codePoint === ZWJ && ZWJ_JOINABLE.has(info)) {
    return [0, ZWJ_EMOJI_PRESENTATION];
  }
  if (info === ZWJ_EMOJI_PRESENTATION) {
    if (codePoint === KEYCAP) return [0, KEYCAP_ZWJ_EMOJI_PRESENTATION];
    if (inRanges(EMOJI_MODIFIERS, codePoint)) return [0, EMOJI_MODIFIER];
    if (codePoint === TAG_CANCEL) return [0, TAG_END_ZWJ_EMOJI_PRESENTATION];
  }
  if (info === VS16_ZWJ_EMOJI_PRESENTATION && startsEmojiSequence(codePoint)) {
    return [0, EMOJI_PRESENTATION];
  }
  if (
    info === VS16_KEYCAP_ZWJ_EMOJI_PRESENTATION &&
    inRanges(KEYCAP_BASES, codePoint)
  ) {
    return [0, EMOJI_PRESENTATION];
  }
  const step = tagStep(codePoint, info);
  if (step !== undefined) return step;
  if (
    info === ZWJ_EMOJI_PRESENTATION &&
    lookupWidth(codePoint)[1] === EMOJI_PRESENTATION
  ) {
    return [0, EMOJI_PRESENTATION];
  }
  return undefined;
}

function kiratRaiStep(codePoint: number, info: number): Step | undefined {
  if (info === KIRAT_RAI_VOWEL_SIGN_E) {
    if (codePoint === 0x16d63 || codePoint === 0x16d69) return [0, DEFAULT];
    if (codePoint === 0x16d67) return [0, KIRAT_RAI_VOWEL_SIGN_AI];
    if (codePoint === 0x16d68) return [1, KIRAT_RAI_VOWEL_SIGN_E];
  }
  if (info === KIRAT_RAI_VOWEL_SIGN_AI && codePoint === 0x16d63) {
    return [0, DEFAULT];
  }
  return undefined;
}

/** unicode-width 0.2.2 `width_in_str`: `codePoint` read before the state `next`. */
function widthInText(codePoint: number, next: number): Step {
  let info = next;
  if (hasBits(info, VARIATION_SELECTOR_16)) {
    if (startsEmojiSequence(codePoint)) {
      const joined = (info & ZWJ_PRESENTATION_MASK) === VS16_ZWJ_MASK;
      return [joined ? 0 : 2, EMOJI_PRESENTATION];
    }
    info = unsetEmojiPresentation(info);
  }
  if (codePoint <= 0xa0) {
    return codePoint === 0xa ? [1, LINE_FEED] : [1, DEFAULT];
  }
  if (info !== DEFAULT) {
    const selected = selectorStep(codePoint, info);
    if (selected.step !== undefined) return selected.step;
    info = selected.info;
    const step =
      ligatureStep(codePoint, info) ??
      scriptLigatureStep(codePoint, info) ??
      emojiStep(codePoint, info) ??
      kiratRaiStep(codePoint, info);
    if (step !== undefined) return step;
  }
  return lookupWidth(codePoint);
}

/**
 * Columns `text` takes as oxfmt counts them, through a port of the
 * unicode-width 0.2.2 `str_width` it uses: code points are read from the end,
 * each one's width depending on the sequence that follows it.
 */
export function textWidth(text: string): number {
  if (PRINTABLE_ASCII_RE.test(text)) {
    return text.length;
  }
  const codePoints = Array.from(
    text,
    (character) => character.codePointAt(0) ?? 0,
  );
  let columns = 0;
  let info = DEFAULT;
  for (let index = codePoints.length - 1; index >= 0; index--) {
    const [width, state] = widthInText(codePoints[index], info);
    columns += width;
    info = state;
  }
  return columns;
}
