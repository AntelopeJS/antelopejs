import type { AddHelpTextContext, Command, Help } from "commander";

export interface HelpExample {
  description: string;
  command: string;
}

/** The stream a help page is written to. */
export interface HelpStream {
  isTTY?: boolean;
  columns?: number;
}

const HELP_FLAGS = "-h, --help";
const HELP_DESCRIPTION = "Show help for a command";
const HELP_COMMAND = "help [command]";
const EXAMPLES_TITLE = "Examples:";
const EXAMPLE_INDENT = "  ";
const COMMENT_PREFIX = "# ";
const PROMPT_PREFIX = "$ ";
const LINE_END = "\n";
const WORD_SEPARATOR = " ";
const UNBREAKABLE_SPACE = " ";
const MAX_HELP_WIDTH = 80;
const MIN_DESCRIPTION_WIDTH = 30;
const ITEM_INDENT = "  ";
const COLUMN_GAP = "  ";
const STACKED_INDENT = "      ";
const ITEM_MARGIN_WIDTH = ITEM_INDENT.length + COLUMN_GAP.length;

/**
 * The width help is wrapped to: the terminal's, up to 80 columns, and 80
 * columns when the stream is not a terminal.
 */
export function helpWidth(stream: HelpStream = process.stdout): number {
  const columns = stream.isTTY ? stream.columns : undefined;
  return columns ? Math.min(columns, MAX_HELP_WIDTH) : MAX_HELP_WIDTH;
}

/**
 * The width of the help page Commander is writing: on stderr after a usage
 * error, on stdout otherwise.
 */
export function helpTextWidth(context: AddHelpTextContext): number {
  return helpWidth(context.error ? process.stderr : process.stdout);
}

/** `text` with its spaces kept on one line by {@link wrapText}. */
export function unbreakable(text: string): string {
  return text.replaceAll(WORD_SEPARATOR, UNBREAKABLE_SPACE);
}

function appendWord(lines: string[], word: string, width: number): string[] {
  const current = lines.at(-1) ?? "";
  const isFull =
    current !== "" &&
    current.length + WORD_SEPARATOR.length + word.length > width;
  if (isFull) {
    return [...lines, word];
  }
  const line = current === "" ? word : `${current}${WORD_SEPARATOR}${word}`;
  return [...lines.slice(0, -1), line];
}

function wrapParagraph(paragraph: string, width: number): string[] {
  return paragraph
    .split(WORD_SEPARATOR)
    .reduce((lines, word) => appendWord(lines, word, width), [""]);
}

/**
 * Breaks `text` into lines of at most `width` characters, between words and
 * at its own line breaks. A word longer than `width` stays whole, and the
 * words of an {@link unbreakable} run stay on one line.
 */
export function wrapText(text: string, width: number): string[] {
  return text
    .split(LINE_END)
    .flatMap((paragraph) => wrapParagraph(paragraph, width))
    .map((line) => line.replaceAll(UNBREAKABLE_SPACE, WORD_SEPARATOR));
}

function indentLines(lines: string[], indent: string): string[] {
  return lines.map((line) => `${indent}${line}`);
}

/**
 * An option, command or other term with its description, laid out like
 * Commander's lists: the description beside the term padded to `termWidth`,
 * wrapped to `width`, or under the term when fewer than 30 columns are left
 * beside it.
 */
export function formatHelpItem(
  term: string,
  termWidth: number,
  description: string,
  width: number,
): string[] {
  if (!description) {
    return [`${ITEM_INDENT}${term}`];
  }
  const descriptionIndent = ITEM_MARGIN_WIDTH + termWidth;
  if (width - descriptionIndent < MIN_DESCRIPTION_WIDTH) {
    return [
      `${ITEM_INDENT}${term}`,
      ...indentLines(
        wrapText(description, width - STACKED_INDENT.length),
        STACKED_INDENT,
      ),
    ];
  }
  const [first, ...rest] = wrapText(description, width - descriptionIndent);
  return [
    `${ITEM_INDENT}${term.padEnd(termWidth)}${COLUMN_GAP}${first}`,
    ...indentLines(rest, " ".repeat(descriptionIndent)),
  ];
}

function formatCommanderItem(
  this: Help,
  term: string,
  termWidth: number,
  description: string,
  helper: Help,
): string {
  const width = helper.helpWidth ?? MAX_HELP_WIDTH;
  const isWideEnough =
    width - termWidth - ITEM_MARGIN_WIDTH >= MIN_DESCRIPTION_WIDTH;
  if (!description || isWideEnough) {
    const commanderHelp = Object.getPrototypeOf(this) as Help;
    return commanderHelp.formatItem.call(
      this,
      term,
      termWidth,
      description,
      helper,
    );
  }
  return formatHelpItem(term, termWidth, description, width).join(LINE_END);
}

function formatExample(example: HelpExample, width: number): string[] {
  const comment = `${EXAMPLE_INDENT}${COMMENT_PREFIX}`;
  return [
    ...indentLines(
      wrapText(example.description, width - comment.length),
      comment,
    ),
    `${EXAMPLE_INDENT}${PROMPT_PREFIX}${example.command}`,
  ];
}

/**
 * Renders the `Examples:` block of a help page: each example as a shell
 * comment describing it, wrapped to `width`, followed by the command to
 * run, kept whole so it can be copied.
 */
export function formatExamples(
  examples: HelpExample[],
  width: number = helpWidth(),
): string {
  return [
    EXAMPLES_TITLE,
    ...examples.flatMap((example) => formatExample(example, width)),
  ].join(LINE_END);
}

/**
 * Appends an `Examples:` block to the help page of the command, wrapped to
 * the width of the page.
 */
export function withExamples(
  command: Command,
  examples: HelpExample[],
): Command {
  return command.addHelpText(
    "after",
    (context) => `\n${formatExamples(examples, helpTextWidth(context))}`,
  );
}

/**
 * Makes a command group run without a subcommand print its help on stdout
 * and exit with code 0, like `ajs` run without arguments. Commander only
 * shows the help as an error (on stderr, exit code 1) when the subcommand is
 * missing; an unknown subcommand is still a usage error.
 */
function showHelpWithoutSubcommand(command: Command): void {
  const showHelp = command.help.bind(command);
  command.help = () => showHelp({ error: false });
}

/**
 * Applies the help conventions of `ajs` to the command and all its
 * subcommands: the wording of `--help` and of the `help` command, the
 * global options listed on every help page, pages wrapped to the terminal,
 * up to 80 columns, with each description under its term when the terminal
 * leaves it fewer than 30 columns beside it, and command groups run without
 * a subcommand printing their help like a successful `--help`.
 */
export function applyHelpConventions(command: Command): void {
  command
    .helpOption(HELP_FLAGS, HELP_DESCRIPTION)
    .configureHelp({
      showGlobalOptions: true,
      formatItem: formatCommanderItem,
      minWidthToWrap: MIN_DESCRIPTION_WIDTH,
    })
    .configureOutput({
      getOutHelpWidth: () => helpWidth(process.stdout),
      getErrHelpWidth: () => helpWidth(process.stderr),
    });
  if (command.commands.length > 0) {
    command.helpCommand(HELP_COMMAND, HELP_DESCRIPTION);
    showHelpWithoutSubcommand(command);
  }
  command.commands.forEach(applyHelpConventions);
}
