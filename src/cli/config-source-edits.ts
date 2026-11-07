import type * as TypeScript from "typescript";

const SAFE_KEY_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/** A replacement of the source between `start` and `end` by `text`. */
export interface SourceEdit {
  start: number;
  end: number;
  text: string;
}

/** The parsed file an edit applies to, and the layout new text follows. */
export interface SourceLayout {
  ts: typeof TypeScript;
  sourceFile: TypeScript.SourceFile;
  indentation: string;
  newline: string;
}

/** `key` as an object literal key: bare when it is an identifier, quoted otherwise. */
function formatKey(key: string): string {
  return SAFE_KEY_RE.test(key) ? key : JSON.stringify(key);
}

function lineIndentAt(text: string, position: number): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return text.slice(lineStart, position).match(/^[\t ]*/)?.[0] ?? "";
}

function startsOwnLine(text: string, position: number): boolean {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return lineStart > 0 && /^[\t ]*$/.test(text.slice(lineStart, position));
}

function lineBreakBefore(text: string, newlineIndex: number): number {
  return text[newlineIndex - 1] === "\r" ? newlineIndex - 1 : newlineIndex;
}

/**
 * The end of the line holding `position`, past the comments that follow it
 * there, when nothing else is left on that line; the line break is excluded.
 */
function clearLineEnd(
  layout: SourceLayout,
  position: number,
): number | undefined {
  const text = layout.sourceFile.text;
  const comments = layout.ts.getTrailingCommentRanges(text, position) ?? [];
  const end = comments.at(-1)?.end ?? position;
  const newlineIndex = text.indexOf("\n", end);
  const lineEnd =
    newlineIndex < 0 ? text.length : lineBreakBefore(text, newlineIndex);
  return /^[\t ]*$/.test(text.slice(end, lineEnd)) ? lineEnd : undefined;
}

/** The end of the comma token that follows `property` in `object`, if any. */
function commaEnd(
  sourceFile: TypeScript.SourceFile,
  object: TypeScript.ObjectLiteralExpression,
  property: TypeScript.ObjectLiteralElementLike,
): number | undefined {
  const tokens = object
    .getChildren(sourceFile)
    .map((child) => child.getChildren(sourceFile))
    .find((children) => children.includes(property));
  const next = tokens?.[tokens.indexOf(property) + 1];
  return next?.getText(sourceFile) === "," ? next.end : undefined;
}

/**
 * The comma that ends an entry added to the empty `object`: none when the
 * property holding `object` is the last of its object and has no comma, so
 * the file keeps its style, and the formatter's comma otherwise.
 */
function emptyObjectComma(
  text: string,
  object: TypeScript.ObjectLiteralExpression,
): string {
  return text.slice(object.end).trimStart().startsWith("}") ? "" : ",";
}

/** A config value as source: its laid-out text, and the string itself when it is one. */
export interface ValueSource {
  serialized: string;
  string?: string;
}

function inlineValue(value: ValueSource): string {
  return value.serialized
    .replace(/,?\n\s*\]/g, "]")
    .replace(/,?\n\s*\}/g, " }")
    .replace(/\[\n\s*/g, "[")
    .replace(/\n\s*/g, " ");
}

/** The line break that ends the line holding `position`, or the file's when that line is the last. */
function lineBreakOf(layout: SourceLayout, position: number): string {
  const text = layout.sourceFile.text;
  const index = text.indexOf("\n", position);
  if (index < 0) {
    return layout.newline;
  }
  return text[index - 1] === "\r" ? "\r\n" : "\n";
}

function indentLines(lineBreak: string, value: ValueSource, indent: string) {
  return value.serialized.replace(/\n/g, `${lineBreak}${indent}`);
}

/** Replaces a literal by `value`, keeping the quote style of a string it replaces. */
export function replacementEdit(
  layout: SourceLayout,
  node: TypeScript.Node,
  value: ValueSource,
): SourceEdit {
  const { sourceFile } = layout;
  const start = node.getStart(sourceFile);
  const original = node.getText(sourceFile);
  const singleLine =
    /^[[{][^\n]*$/.test(original) ||
    !node.parent.parent.getText(sourceFile).includes("\n");
  let text = singleLine
    ? inlineValue(value)
    : indentLines(
        lineBreakOf(layout, start),
        value,
        lineIndentAt(sourceFile.text, start),
      );
  if (value.string !== undefined && original.startsWith("'")) {
    const escaped = JSON.stringify(value.string)
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/'/g, "\\'");
    text = `'${escaped}'`;
  }
  return { start, end: node.end, text };
}

/**
 * Adds `key: value` after the last property of `object`, on its own line when
 * the object spans lines. A property on its own line ends with a comma when
 * the last one did; in an object that had none, it follows the property that
 * holds the object (see {@link emptyObjectComma}).
 */
export function insertionEdit(
  layout: SourceLayout,
  object: TypeScript.ObjectLiteralExpression,
  key: string,
  value: ValueSource,
): SourceEdit {
  const { sourceFile, indentation } = layout;
  const text = sourceFile.text;
  const objectStart = object.getStart(sourceFile);
  const objectIndent = lineIndentAt(text, objectStart);
  const last = object.properties.at(-1);
  if (!last) {
    const inner = objectIndent + indentation;
    const newline = lineBreakOf(layout, objectStart);
    const entry = `${formatKey(key)}: ${indentLines(newline, value, inner)}`;
    const closingBrace = object.end - 1;
    if (startsOwnLine(text, closingBrace)) {
      const closing = text.lastIndexOf("\n", closingBrace - 1);
      const at = lineBreakBefore(text, closing);
      return {
        start: at,
        end: at,
        text: `${newline}${inner}${entry}${emptyObjectComma(text, object)}`,
      };
    }
    const innerText = text.slice(objectStart + 1, object.end - 1);
    if (innerText.trim() !== "") {
      const at = objectStart + 1 + innerText.trimEnd().length;
      return {
        start: at,
        end: at,
        text: ` ${formatKey(key)}: ${inlineValue(value)}`,
      };
    }
    return {
      start: objectStart,
      end: object.end,
      text: `{${newline}${inner}${entry}${emptyObjectComma(text, object)}${newline}${objectIndent}}`,
    };
  }
  const lastStart = last.getStart(sourceFile);
  const multiline = startsOwnLine(text, lastStart);
  const indent = multiline ? lineIndentAt(text, lastStart) : objectIndent;
  const comma = commaEnd(sourceFile, object, last);
  const trailingComma = comma !== undefined;
  const anchor = comma ?? last.end;
  if (!multiline) {
    const inline = inlineValue(value);
    const separator = trailingComma ? " " : ", ";
    return {
      start: anchor,
      end: anchor,
      text: `${separator}${formatKey(key)}: ${inline}`,
    };
  }
  const lineEnd = clearLineEnd(layout, anchor) ?? anchor;
  const kept = text.slice(anchor, lineEnd);
  const lineBreak = lineBreakOf(layout, lineEnd);
  const entry = `${formatKey(key)}: ${indentLines(lineBreak, value, indent)}`;
  return {
    start: anchor,
    end: lineEnd,
    text: `${trailingComma ? "" : ","}${kept}${lineBreak}${indent}${entry}${trailingComma ? "," : ""}`,
  };
}

/**
 * Deletes `property` from `object`. A property alone on its line goes with
 * that line, the comment lines above it and the comments after it; one that
 * shares its line with other code leaves the line break in place.
 */
export function removalEdit(
  layout: SourceLayout,
  object: TypeScript.ObjectLiteralExpression,
  property: TypeScript.ObjectLiteralElementLike,
): SourceEdit {
  const { sourceFile } = layout;
  const text = sourceFile.text;
  const start = property.getStart(sourceFile);
  const afterComma = commaEnd(sourceFile, object, property) ?? property.end;
  const leading =
    layout.ts.getLeadingCommentRanges(text, property.getFullStart()) ?? [];
  const firstOwn =
    leading.find((comment) => startsOwnLine(text, comment.pos))?.pos ??
    (startsOwnLine(text, start) ? start : undefined);
  if (firstOwn !== undefined) {
    const lineEnd = clearLineEnd(layout, afterComma);
    if (lineEnd === undefined) {
      const blanks = text.slice(afterComma).match(/^[\t ]*/)?.[0].length ?? 0;
      return { start: firstOwn, end: afterComma + blanks, text: "" };
    }
    const lineBreak = text.lastIndexOf("\n", firstOwn - 1);
    return { start: lineBreakBefore(text, lineBreak), end: lineEnd, text: "" };
  }
  const properties = object.properties;
  const index = properties.indexOf(property);
  const next = properties.at(index + 1);
  if (next) {
    return { start, end: next.getStart(sourceFile), text: "" };
  }
  if (index > 0) {
    return { start: properties[index - 1].end, end: property.end, text: "" };
  }
  return { start, end: afterComma, text: "" };
}
