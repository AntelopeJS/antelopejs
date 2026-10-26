import { win32 } from "node:path";

import { WINDOWS_PLATFORM } from "./package-manager-name";

const SHELL_SCRIPT_EXTENSIONS = [".cmd", ".bat"];
const DEFAULT_COMMAND_SHELL = "cmd.exe";
const COMMAND_SHELL_SWITCHES = ["/d", "/s", "/c"];
const META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;
const META_ESCAPE = "^$1";
const BACKSLASHES_BEFORE_QUOTE = /(\\*)"/g;
const TRAILING_BACKSLASHES = /(\\*)$/;
const NODE_MODULES_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

export interface ProcessInvocation {
  executable: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/**
 * Tells whether the executable is a Windows shell script that the operating
 * system cannot execute on its own and that therefore needs `cmd.exe`.
 */
export function requiresShell(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== WINDOWS_PLATFORM) {
    return false;
  }
  const lowercased = executable.toLowerCase();
  return SHELL_SCRIPT_EXTENSIONS.some((extension) =>
    lowercased.endsWith(extension),
  );
}

function escapeCommand(command: string): string {
  return win32.normalize(command).replace(META_CHARACTERS, META_ESCAPE);
}

function escapeArgument(argument: string, doubleEscape: boolean): string {
  const quoted = `"${argument
    .replace(BACKSLASHES_BEFORE_QUOTE, '$1$1\\"')
    .replace(TRAILING_BACKSLASHES, "$1$1")}"`;
  const escaped = quoted.replace(META_CHARACTERS, META_ESCAPE);
  return doubleEscape ? escaped.replace(META_CHARACTERS, META_ESCAPE) : escaped;
}

function commandShell(): string {
  return process.env.ComSpec || DEFAULT_COMMAND_SHELL;
}

/**
 * Builds the executable and arguments to spawn, quoting them for `cmd.exe`
 * when the target is a Windows shell script.
 *
 * `shell: true` is deliberately not used: node then joins the executable and
 * the arguments with spaces into a single `cmd.exe /d /s /c "..."` string, so
 * any value containing a space is re-split by `cmd.exe` and any value
 * containing `&`, `|`, `<`, `>` or `^` is interpreted by it. Arguments are
 * quoted for `CommandLineToArgvW` and then escaped for the `cmd.exe` parser,
 * and the whole command line is passed verbatim so the two escaping layers
 * survive. Arguments going through a `node_modules/.bin` shim cross a second
 * `cmd.exe` parse inside the shim and are escaped twice.
 *
 * The escaping rules are the ones `cross-spawn` applies, themselves derived
 * from the `cmd.exe` parsing rules documented at https://qntm.org/cmd.
 */
export function buildProcessInvocation(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): ProcessInvocation {
  if (!requiresShell(executable, platform)) {
    return { executable, args };
  }
  const doubleEscape = NODE_MODULES_SHIM.test(executable);
  const command = [
    escapeCommand(executable),
    ...args.map((argument) => escapeArgument(argument, doubleEscape)),
  ].join(" ");
  return {
    executable: commandShell(),
    args: [...COMMAND_SHELL_SWITCHES, `"${command}"`],
    windowsVerbatimArguments: true,
  };
}
