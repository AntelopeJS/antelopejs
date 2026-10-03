import { getProcessPalette } from "../../output";

const NAME_SEPARATOR = ", ";

/** Lists names of things (modules, packages) in bold, comma-separated. */
export function formatNames(names: string[]): string {
  const palette = getProcessPalette();
  return names.map((name) => palette.bold(name)).join(NAME_SEPARATOR);
}
