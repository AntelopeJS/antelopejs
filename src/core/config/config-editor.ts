import type * as TypeScript from "typescript";

type TS = typeof TypeScript;

/**
 * The fields of a module entry to write. A field set to `undefined` or `null`
 * is removed from the entry.
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported edits intentionally accept arbitrary module-specific fields; a concrete value schema would change the declaration.
export type ModuleEntryChanges = Record<string, unknown>;

interface EditContext {
  ts: TS;
  fileName: string;
  /** One level of indentation, as the file writes it. */
  unit: string;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

const MODULES_KEY = "modules";
const DEFINE_CONFIG = "defineConfig";
const PACKAGE_SOURCE = "package";
const SAFE_KEY = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const NEWLINE = "\n";
const FIRST_INDENT = /\n([\t ]+)\S/;
const TAB = "\t";
const LEADING_SPACE = /^[ \t]*/;
const DEFAULT_UNIT = "  ";

export class ConfigEditError extends Error {}

function parse(context: EditContext, source: string): TypeScript.SourceFile {
  const { ts } = context;
  return ts.createSourceFile(
    context.fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function rootObject(
  context: EditContext,
  file: TypeScript.SourceFile,
): TypeScript.ObjectLiteralExpression {
  const { ts } = context;
  const assignment = file.statements.find(
    (statement): statement is TypeScript.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  let expression = assignment?.expression;
  if (
    expression &&
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === DEFINE_CONFIG
  ) {
    expression = expression.arguments[0];
  }
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    throw new ConfigEditError(
      "The configuration's default export is not an object literal it can edit",
    );
  }
  return expression;
}

function propertyName(
  context: EditContext,
  property: TypeScript.ObjectLiteralElementLike,
): string | undefined {
  const { ts } = context;
  if (!ts.isPropertyAssignment(property)) return undefined;
  const { name } = property;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function findProperty(
  context: EditContext,
  object: TypeScript.ObjectLiteralExpression,
  name: string,
): TypeScript.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is TypeScript.PropertyAssignment =>
      propertyName(context, property) === name,
  );
}

function lineIndent(source: string, position: number): string {
  const lineStart = source.lastIndexOf(NEWLINE, position - 1) + 1;
  return source.slice(lineStart).match(LEADING_SPACE)?.[0] ?? "";
}

/** `value` as source text, its continuation lines indented by `indent`. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- ModuleEntryChanges values may be arbitrary JavaScript values; this serializer must preserve existing output and errors.
function serializeValue(value: unknown, unit: string, indent: string): string {
  return serializeAt(value, unit, 0).split(NEWLINE).join(`${NEWLINE}${indent}`);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The editor recursively serializes the exported arbitrary-value edit contract without adding input rejection.
function serializeAt(value: unknown, unit: string, depth: number): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The exported editor accepts arbitrary values; JSON handles primitives/functions while object fields retain the existing recursive formatting.
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  const inner = unit.repeat(depth + 1);
  const outer = unit.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => serializeAt(item, unit, depth + 1));
    return `[\n${items.map((item) => `${inner}${item}`).join(",\n")},\n${outer}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  const lines = entries.map(
    ([key, v]) =>
      `${inner}${formatKey(key)}: ${serializeAt(v, unit, depth + 1)}`,
  );
  return `{\n${lines.join(",\n")},\n${outer}}`;
}

function formatKey(key: string): string {
  return SAFE_KEY.test(key) ? key : JSON.stringify(key);
}

function closingBrace(object: TypeScript.ObjectLiteralExpression): number {
  return object.end - 1;
}

/**
 * Adds `key: value` as the object's last property, after a comma, at the
 * indentation of its other properties.
 */
function insertProperty(
  context: EditContext,
  source: string,
  object: TypeScript.ObjectLiteralExpression,
  key: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Inserted fields come from ModuleEntryChanges, whose exported contract permits arbitrary values.
  value: unknown,
): TextEdit {
  const close = closingBrace(object);
  const closeIndent = lineIndent(source, close);
  const last = object.properties.at(-1);
  const indent = last
    ? lineIndent(source, last.getStart())
    : `${closeIndent}${context.unit}`;
  const property = `${indent}${formatKey(key)}: ${serializeValue(value, context.unit, indent)},`;
  if (!last) {
    const text = `{\n${property}\n${closeIndent}}`;
    return { start: object.getStart(), end: object.end, text };
  }
  const between = source.slice(last.end, close);
  const hasComma = between.trimStart().startsWith(",");
  const anchor = hasComma ? last.end + between.indexOf(",") + 1 : last.end;
  const text = `${hasComma ? "" : ","}\n${property}`;
  return { start: anchor, end: anchor, text };
}

function replaceValue(
  context: EditContext,
  source: string,
  property: TypeScript.PropertyAssignment,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Replaced fields preserve ModuleEntryChanges' arbitrary values through the existing serializer.
  value: unknown,
): TextEdit {
  const indent = lineIndent(source, property.getStart());
  return {
    start: property.initializer.getStart(),
    end: property.initializer.end,
    text: serializeValue(value, context.unit, indent),
  };
}

/** Removes a property with its line and the comma that follows it. */
function removeProperty(
  source: string,
  property: TypeScript.ObjectLiteralElementLike,
): TextEdit {
  const lineStart = source.lastIndexOf(NEWLINE, property.getStart() - 1) + 1;
  const before = source.slice(lineStart, property.getStart());
  const start = before.trim() === "" ? lineStart : property.getStart();
  let end = property.end;
  const rest = source.slice(end);
  const comma = rest.match(/^\s*,/);
  if (comma) end += comma[0].length;
  const newline = source.slice(end).match(/^[ \t]*\n/);
  if (newline && start === lineStart) end += newline[0].length;
  return { start, end, text: "" };
}

function applyEdit(source: string, edit: TextEdit): string {
  return `${source.slice(0, edit.start)}${edit.text}${source.slice(edit.end)}`;
}

/** The file's indentation step: its first indented line's indentation. */
function detectUnit(source: string): string {
  const match = source.match(FIRST_INDENT);
  if (!match) return DEFAULT_UNIT;
  return match[1].startsWith(TAB) ? TAB : match[1];
}

function modulesObject(
  context: EditContext,
  file: TypeScript.SourceFile,
): TypeScript.ObjectLiteralExpression | undefined {
  const property = findProperty(
    context,
    rootObject(context, file),
    MODULES_KEY,
  );
  if (!property) return undefined;
  if (!context.ts.isObjectLiteralExpression(property.initializer)) {
    throw new ConfigEditError(
      "The configuration's `modules` is not an object literal it can edit",
    );
  }
  return property.initializer;
}

function assertParses(context: EditContext, source: string): void {
  const file: TypeScript.SourceFile & {
    parseDiagnostics?: readonly TypeScript.Diagnostic[];
  } = parse(context, source);
  if ((file.parseDiagnostics ?? []).length > 0) {
    throw new ConfigEditError("The edited configuration would not parse");
  }
}

function createContext(ts: TS, fileName: string, source: string): EditContext {
  return { ts, fileName, unit: detectUnit(source) };
}

interface EnsuredEntry {
  source: string;
  /** The entry was just written whole from the changes. */
  isNew: boolean;
}

/** Module `key`'s entry as an object literal, which it must be by now. */
function entryObject(
  context: EditContext,
  source: string,
  key: string,
): TypeScript.ObjectLiteralExpression {
  const modules = modulesObject(context, parse(context, source));
  const entry = modules && findProperty(context, modules, key);
  if (!entry || !context.ts.isObjectLiteralExpression(entry.initializer)) {
    throw new ConfigEditError(`Module '${key}' has no entry it can edit`);
  }
  return entry.initializer;
}

/** Rewrites one field of an existing entry, adds it, or removes it. */
function setEntryField(
  context: EditContext,
  source: string,
  key: string,
  field: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Field updates forward the exported open edit dictionary's values; validating them would change accepted edits.
  value: unknown,
): string {
  const object = entryObject(context, source, key);
  const property = findProperty(context, object, field);
  if (value === undefined || value === null) {
    return property
      ? applyEdit(source, removeProperty(source, property))
      : source;
  }
  const edit = property
    ? replaceValue(context, source, property, value)
    : insertProperty(context, source, object, field, value);
  return applyEdit(source, edit);
}

/**
 * Turns a string shorthand entry (`"pkg": "^1.0.0"`) into the object it
 * stands for, so its fields can be edited one by one.
 */
function expandShorthand(
  context: EditContext,
  source: string,
  entry: TypeScript.PropertyAssignment,
  key: string,
): string {
  const { ts } = context;
  if (!ts.isStringLiteralLike(entry.initializer)) return source;
  const expanded = {
    source: {
      type: PACKAGE_SOURCE,
      package: key,
      version: entry.initializer.text,
    },
  };
  return applyEdit(source, replaceValue(context, source, entry, expanded));
}

function definedFields(changes: ModuleEntryChanges): ModuleEntryChanges {
  return Object.fromEntries(
    Object.entries(changes).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
}

function addEntry(
  context: EditContext,
  source: string,
  key: string,
  changes: ModuleEntryChanges,
): string {
  const file = parse(context, source);
  const modules = modulesObject(context, file);
  const fields = definedFields(changes);
  const edit = modules
    ? insertProperty(context, source, modules, key, fields)
    : insertProperty(context, source, rootObject(context, file), MODULES_KEY, {
        [key]: fields,
      });
  return applyEdit(source, edit);
}

function ensureEntry(
  context: EditContext,
  source: string,
  key: string,
  changes: ModuleEntryChanges,
): EnsuredEntry {
  const modules = modulesObject(context, parse(context, source));
  const entry = modules && findProperty(context, modules, key);
  if (!entry) {
    return { source: addEntry(context, source, key, changes), isNew: true };
  }
  const { ts } = context;
  if (
    !ts.isObjectLiteralExpression(entry.initializer) &&
    !ts.isStringLiteralLike(entry.initializer)
  ) {
    throw new ConfigEditError(
      `Module '${key}' is not declared by an object it can edit`,
    );
  }
  return { source: expandShorthand(context, source, entry, key), isNew: false };
}

/**
 * The configuration source with module `key`'s entry carrying `changes`:
 * each given field is rewritten in place, added, or removed when set to
 * `undefined` or `null`, and nothing else in the file moves. The entry is added when
 * the file has none.
 *
 * @throws ConfigEditError when the file has nothing it can edit safely
 */
export function setModuleEntry(
  ts: TS,
  fileName: string,
  source: string,
  key: string,
  changes: ModuleEntryChanges,
): string {
  const context = createContext(ts, fileName, source);
  const ensured = ensureEntry(context, source, key, changes);
  const result = ensured.isNew
    ? ensured.source
    : Object.entries(changes).reduce(
        (current, [field, value]) =>
          setEntryField(context, current, key, field, value),
        ensured.source,
      );
  assertParses(context, result);
  return result;
}

/**
 * The configuration source without module `key`'s entry, the rest of the
 * file untouched. Returns the source as is when there is no such entry.
 */
export function removeModuleEntry(
  ts: TS,
  fileName: string,
  source: string,
  key: string,
): string {
  const context = createContext(ts, fileName, source);
  const modules = modulesObject(context, parse(context, source));
  const entry = modules && findProperty(context, modules, key);
  if (!entry) return source;
  const result = applyEdit(source, removeProperty(source, entry));
  assertParses(context, result);
  return result;
}
