import type {
  CapabilityContext,
  ChannelFlags,
  InteractivityContext,
  OutputCapabilities,
  OutputStream,
  OutputStreams,
} from "./types";
import { isVerboseRun } from "./verbosity";

interface EnvironmentMatch {
  variable: string;
  values?: string[];
}

const NO_COLOR_FLAG = "--no-color";
const DUMB_TERMINAL = "dumb";
const LINUX_CONSOLE_TERMINAL = "linux";
const WINDOWS_PLATFORM = "win32";
const DISABLED_FLAG_VALUES = ["0", "false"];
const LOCALE_VARIABLES = ["LC_ALL", "LC_CTYPE", "LANG"];
const UTF8_LOCALE_PATTERN = /utf-?8/i;

const UNICODE_WINDOWS_TERMINALS: EnvironmentMatch[] = [
  { variable: "WT_SESSION" },
  { variable: "TERMINUS_SUBLIME" },
  { variable: "ConEmuTask", values: ["{cmd::Cmder}"] },
  { variable: "TERM_PROGRAM", values: ["Terminus-Sublime", "vscode"] },
  {
    variable: "TERM",
    values: [
      "xterm-256color",
      "alacritty",
      "rxvt-unicode",
      "rxvt-unicode-256color",
    ],
  },
  { variable: "TERMINAL_EMULATOR", values: ["JetBrains-JediTerm"] },
];

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function isEnabledFlag(value: string | undefined): boolean {
  return isSet(value) && !DISABLED_FLAG_VALUES.includes(value.toLowerCase());
}

function matchesEnvironment(
  env: NodeJS.ProcessEnv,
  match: EnvironmentMatch,
): boolean {
  const value = env[match.variable];
  if (!isSet(value)) {
    return false;
  }
  return match.values?.includes(value) ?? true;
}

function hasUtf8Locale(env: NodeJS.ProcessEnv): boolean {
  const locale = LOCALE_VARIABLES.map((name) => env[name]).find(isSet);
  return locale === undefined || UTF8_LOCALE_PATTERN.test(locale);
}

/**
 * Whether the terminal can draw the Unicode symbol set. Never on a dumb
 * terminal; on Windows only in terminals known to render it (the legacy
 * console does not); elsewhere unless the locale is explicitly not UTF-8 or
 * the output is the Linux virtual console.
 */
export function hasUnicodeSupport(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  if (env.TERM === DUMB_TERMINAL) {
    return false;
  }
  if (platform === WINDOWS_PLATFORM) {
    return UNICODE_WINDOWS_TERMINALS.some((match) =>
      matchesEnvironment(env, match),
    );
  }
  return env.TERM !== LINUX_CONSOLE_TERMINAL && hasUtf8Locale(env);
}

function isColorDisabled(context: CapabilityContext): boolean {
  return context.argv.includes(NO_COLOR_FLAG) || isSet(context.env.NO_COLOR);
}

/**
 * Whether a stream gets colors. `--no-color` and `NO_COLOR` always win, then
 * `FORCE_COLOR` (`0` or `false` turns colors off), then colors are only
 * used on an interactive terminal that is neither dumb nor running in CI.
 */
export function hasColorSupport(
  context: CapabilityContext,
  stream: OutputStream,
): boolean {
  if (isColorDisabled(context)) {
    return false;
  }
  const { env } = context;
  if (isSet(env.FORCE_COLOR)) {
    return isEnabledFlag(env.FORCE_COLOR);
  }
  if (env.TERM === DUMB_TERMINAL || isEnabledFlag(env.CI)) {
    return false;
  }
  return stream.isTTY === true;
}

function mapChannels(
  streams: OutputStreams,
  detect: (stream: OutputStream) => boolean,
): ChannelFlags {
  return { result: detect(streams.result), feedback: detect(streams.feedback) };
}

export function detectCapabilities(
  context: CapabilityContext,
): OutputCapabilities {
  return {
    hasUnicode: hasUnicodeSupport(context.env, context.platform),
    colors: mapChannels(context.streams, (stream) =>
      hasColorSupport(context, stream),
    ),
    terminals: mapChannels(context.streams, (stream) => stream.isTTY === true),
  };
}

/**
 * Whether progress can be drawn as an animated task list: feedback goes to
 * an interactive terminal that is not dumb, the run is not in CI, and it is
 * not verbose (verbose runs print every log line instead). Otherwise tasks
 * only print their final line, append-only.
 */
export function hasLiveProgress(context: CapabilityContext): boolean {
  const { env } = context;
  return (
    context.streams.feedback.isTTY === true &&
    env.TERM !== DUMB_TERMINAL &&
    !isEnabledFlag(env.CI) &&
    !isVerboseRun({ argv: context.argv, env })
  );
}

/**
 * Whether questions can be asked: standard input and the stream prompts are
 * drawn on are terminals, and the run is not in CI.
 */
export function isInteractiveSession(context: InteractivityContext): boolean {
  return (
    context.input.isTTY === true &&
    context.output.isTTY === true &&
    !isEnabledFlag(context.env.CI)
  );
}

export function processStreams(): OutputStreams {
  return { result: process.stdout, feedback: process.stderr };
}

export function processCapabilityContext(): CapabilityContext {
  return {
    env: process.env,
    argv: process.argv,
    platform: process.platform,
    streams: processStreams(),
  };
}
