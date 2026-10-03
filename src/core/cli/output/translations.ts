import { ExecError } from "../command";
import { stripAnsiCodes } from "../logging-utils";
import type { CliProblem } from "./types";

interface ExecTranslation {
  command: RegExp;
  output: RegExp;
  describe(
    commandMatch: RegExpMatchArray,
    outputMatch: RegExpMatchArray,
  ): CliProblem;
}

type SystemErrorTranslation = (error: NodeJS.ErrnoException) => CliProblem;

const REMOTE_URL = String.raw`((?:[\w+.-]+:\/\/|[\w.-]+@)\S+)`;
const MISSING_EXECUTABLE =
  /([^\s:]+): (?:command )?not found|'([^']+)' is not recognized as an internal/;
const NETWORK_ERROR_CODES =
  /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b/;

const EXEC_TRANSLATIONS: ExecTranslation[] = [
  {
    command: /^npm view (\S+)/,
    output: /\bE404\b/,
    describe: ([, name]) => ({
      title: `Package '${name}' not found on the npm registry`,
      reason: "The registry answered 404: the name is wrong or the package is private.",
      fixes: [`Check the name: npm view ${name}`],
    }),
  },
  {
    command: /^(?:npm|pnpm|yarn)\s/,
    output: NETWORK_ERROR_CODES,
    describe: (_, [, code]) => ({
      title: "Cannot reach the npm registry",
      reason: `The network request failed (${code}).`,
      fixes: [
        "Check your network connection, proxy and registry settings, then try again",
      ],
    }),
  },
  {
    command: /^git\s/,
    output:
      /Could not resolve host|Failed to connect|Connection refused|Connection timed out/i,
    describe: (_, [cause]) => ({
      title: "Cannot reach the git server",
      reason: `git failed: ${cause}.`,
      fixes: [
        "Check your network connection and the repository URL, then try again",
      ],
    }),
  },
  {
    command: new RegExp(String.raw`^git clone\b.*?${REMOTE_URL}`),
    output:
      /could not read (?:Username|Password)|unable to get password|terminal prompts disabled|Authentication failed|Repository not found|not found/i,
    describe: ([, url]) => ({
      title: `Could not clone ${url}`,
      reason: "The repository does not exist or requires authentication.",
      fixes: [`Check the URL and your access to it: git ls-remote ${url}`],
    }),
  },
  {
    command: /^/,
    output: MISSING_EXECUTABLE,
    describe: (_, [, shellName, windowsName]) => {
      const executable = shellName ?? windowsName;
      return {
        title: `Command not found: ${executable}`,
        fixes: [`Install ${executable}, or make sure it is on your PATH`],
      };
    },
  },
];

function subjectOf(error: NodeJS.ErrnoException): string {
  return error.path ?? error.message;
}

function permissionDenied(error: NodeJS.ErrnoException): CliProblem {
  return {
    title: `Permission denied: ${subjectOf(error)}`,
    fixes: ["Check the permissions of this path, then try again"],
  };
}

const SYSTEM_ERROR_TRANSLATIONS: Record<string, SystemErrorTranslation> = {
  ENOENT: (error) => ({
    title: `Path not found: ${subjectOf(error)}`,
    fixes: ["Check the path, then try again"],
  }),
  ENOTDIR: (error) => ({
    title: `Not a directory: ${subjectOf(error)}`,
    fixes: ["Pass the path of a directory"],
  }),
  EACCES: permissionDenied,
  EPERM: permissionDenied,
};

function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
  );
}

function applyExecTranslation(
  translation: ExecTranslation,
  command: string,
  output: string,
): CliProblem | undefined {
  const commandMatch = command.match(translation.command);
  const outputMatch = output.match(translation.output);
  if (!commandMatch || !outputMatch) {
    return undefined;
  }
  return translation.describe(commandMatch, outputMatch);
}

export function translateExecError(error: ExecError): CliProblem | undefined {
  const output = stripAnsiCodes(error.output);
  return EXEC_TRANSLATIONS.map((translation) =>
    applyExecTranslation(translation, error.command, output),
  ).find((problem) => problem !== undefined);
}

/**
 * Turns a known low-level failure (a missing path, an unknown npm package,
 * an unreachable registry, a git clone that was refused) into a problem that
 * names the cause and the fix. Returns `undefined` for anything else.
 */
export function translateFailure(error: unknown): CliProblem | undefined {
  if (error instanceof ExecError) {
    return translateExecError(error);
  }
  if (isSystemError(error)) {
    return SYSTEM_ERROR_TRANSLATIONS[error.code ?? ""]?.(error);
  }
  return undefined;
}

