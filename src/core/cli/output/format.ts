import { isAbsolute, relative, sep } from "node:path";
import { createColors } from "picocolors";

import { stripAnsi } from "../logging-utils";
import type { Palette } from "./types";

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_MINUTE = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE;
const SECOND_FRACTION_DIGITS = 1;
const PADDED_SECONDS_WIDTH = 2;
const PLURAL_SUFFIX = "s";
const CURRENT_DIRECTORY = ".";
const PARENT_DIRECTORY = "..";

export function createPalette(hasColor: boolean): Palette {
  const colors = createColors(hasColor);
  return {
    green: colors.green,
    red: colors.red,
    yellow: colors.yellow,
    blue: colors.blue,
    cyan: colors.cyan,
    dim: colors.dim,
    bold: colors.bold,
  };
}

/**
 * Counts a noun: `1 module`, `2 modules`. Pass the plural for irregular
 * nouns.
 */
export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}${PLURAL_SUFFIX}`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatMinutes(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / MILLISECONDS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE);
  return `${minutes}m ${seconds.padStart(PADDED_SECONDS_WIDTH, "0")}s`;
}

/**
 * Humanizes a duration: `850ms`, `2.1s`, `1m 05s`.
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < MILLISECONDS_PER_SECOND) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < MILLISECONDS_PER_MINUTE) {
    const seconds = durationMs / MILLISECONDS_PER_SECOND;
    return `${seconds.toFixed(SECOND_FRACTION_DIGITS)}s`;
  }
  return formatMinutes(durationMs);
}

export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Cuts `text` to `width` visible characters, `ellipsis` included, when it is
 * longer. A cut text loses its colors.
 */
export function truncate(text: string, width: number, ellipsis: string): string {
  if (visibleWidth(text) <= width) {
    return text;
  }
  const kept = Math.max(0, width - visibleWidth(ellipsis));
  return `${stripAnsi(text).slice(0, kept)}${ellipsis}`;
}

export function padVisible(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

/**
 * Shows a path relative to the working directory when it lies inside it
 * (`./modules/auth`), and unchanged otherwise.
 */
export function displayPath(target: string, cwd = process.cwd()): string {
  const relativePath = relative(cwd, target);
  const isInside =
    relativePath !== "" &&
    !isAbsolute(relativePath) &&
    relativePath.split(sep)[0] !== PARENT_DIRECTORY;
  return isInside ? `${CURRENT_DIRECTORY}${sep}${relativePath}` : target;
}
