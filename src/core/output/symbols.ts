import type {
  ColorName,
  MessageLevel,
  SymbolSet,
  SymbolSetName,
} from "./types";

export const SYMBOL_SETS: Record<SymbolSetName, SymbolSet> = {
  unicode: {
    levels: {
      success: "✔",
      info: "ℹ",
      warn: "▲",
      error: "✖",
      skip: "–",
      hint: "→",
    },
    bullet: "•",
    rule: "─",
    spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    separator: " · ",
    ellipsis: "…",
    arrow: "→",
  },
  ascii: {
    levels: {
      success: "v",
      info: "i",
      warn: "!",
      error: "x",
      skip: "-",
      hint: ">",
    },
    bullet: "-",
    rule: "-",
    spinner: ["-", "\\", "|", "/"],
    separator: " - ",
    ellipsis: "...",
    arrow: "->",
  },
};

export const LEVEL_COLORS: Record<MessageLevel, ColorName> = {
  success: "green",
  info: "blue",
  warn: "yellow",
  error: "red",
  skip: "dim",
  hint: "cyan",
};

export function selectSymbols(hasUnicode: boolean): SymbolSet {
  return hasUnicode ? SYMBOL_SETS.unicode : SYMBOL_SETS.ascii;
}
