import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { isDeepStrictEqual } from "node:util";
import type * as TypeScript from "typescript";

import { CliError } from "../core/output";
import { printNode, toNode } from "./config-layout";
import {
  insertionEdit,
  removalEdit,
  replacementEdit,
  type SourceEdit,
  type SourceLayout,
  type ValueSource,
} from "./config-source-edits";
import {
  isFunction,
  isPlainObject,
  isString,
  type UnknownDictionary,
} from "../utils";

const FUNCTION_BASED_TS_CONFIG_ERROR =
  "Cannot update antelope.config.ts automatically when default export is function-based.";
const NOT_A_LITERAL_REASON =
  "The value there is not a plain literal, so the command cannot change it without replacing source code with evaluated values.";
const SAFE_KEY_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

type ConfigPath = readonly string[];

/** One difference between the configuration a file evaluates to and the one a command wants written. */
type ConfigChange =
  | { kind: "set"; path: ConfigPath; value: unknown }
  | { kind: "add"; path: ConfigPath; value: unknown }
  | { kind: "remove"; path: ConfigPath };

interface SourceContext extends SourceLayout {
  fileName: string;
}

function formatPath(path: ConfigPath): string {
  return path
    .map((key, index) => {
      if (!SAFE_KEY_RE.test(key)) return `[${JSON.stringify(key)}]`;
      return index === 0 ? key : `.${key}`;
    })
    .join("");
}

function diffConfig(
  before: UnknownDictionary,
  after: UnknownDictionary,
  path: ConfigPath = [],
): ConfigChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key): ConfigChange[] => {
    const previous = Object.hasOwn(before, key) ? before[key] : undefined;
    const next = Object.hasOwn(after, key) ? after[key] : undefined;
    const keyPath = [...path, key];
    if (next === undefined) {
      return previous === undefined ? [] : [{ kind: "remove", path: keyPath }];
    }
    if (previous === undefined) {
      return [{ kind: "add", path: keyPath, value: next }];
    }
    if (isPlainObject(previous) && isPlainObject(next)) {
      return diffConfig(previous, next, keyPath);
    }
    const sameFunction =
      isFunction(previous) &&
      isFunction(next) &&
      previous.toString() === next.toString();
    if (sameFunction || isDeepStrictEqual(previous, next)) {
      return [];
    }
    return [{ kind: "set", path: keyPath, value: next }];
  });
}

function unwrapExpression(
  ts: typeof TypeScript,
  expression: TypeScript.Expression,
): TypeScript.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function findConfigObject(
  ts: typeof TypeScript,
  sourceFile: TypeScript.SourceFile,
): TypeScript.ObjectLiteralExpression | undefined {
  const exportAssignment = sourceFile.statements.find(
    (statement): statement is TypeScript.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  if (!exportAssignment) {
    return undefined;
  }
  let expression = unwrapExpression(ts, exportAssignment.expression);
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "defineConfig" &&
    expression.arguments.length > 0
  ) {
    expression = unwrapExpression(ts, expression.arguments[0]);
  }
  return ts.isObjectLiteralExpression(expression) ? expression : undefined;
}

function propertyName(
  ts: typeof TypeScript,
  property: TypeScript.ObjectLiteralElementLike,
): string | undefined {
  if (
    !ts.isPropertyAssignment(property) &&
    !ts.isShorthandPropertyAssignment(property)
  ) {
    return undefined;
  }
  const name = property.name;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function findProperty(
  ts: typeof TypeScript,
  object: TypeScript.ObjectLiteralExpression,
  key: string,
): TypeScript.ObjectLiteralElementLike | undefined {
  const properties = [...object.properties];
  const names = properties.map((property) => propertyName(ts, property));
  const index = names.lastIndexOf(key);
  const overridden = properties
    .slice(index + 1)
    .some((property) => ts.isSpreadAssignment(property));
  return index < 0 || overridden ? undefined : properties[index];
}

function findObject(
  ts: typeof TypeScript,
  root: TypeScript.ObjectLiteralExpression,
  path: ConfigPath,
): TypeScript.ObjectLiteralExpression | undefined {
  let current: TypeScript.ObjectLiteralExpression | undefined = root;
  for (const key of path) {
    const property: TypeScript.ObjectLiteralElementLike | undefined =
      current && findProperty(ts, current, key);
    if (!property || !ts.isPropertyAssignment(property)) {
      return undefined;
    }
    const value = unwrapExpression(ts, property.initializer);
    current = ts.isObjectLiteralExpression(value) ? value : undefined;
  }
  return current;
}

function isPlainLiteral(
  ts: typeof TypeScript,
  expression: TypeScript.Expression,
): boolean {
  const node = unwrapExpression(ts, expression);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(
      (element) => !ts.isSpreadElement(element) && isPlainLiteral(ts, element),
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        propertyName(ts, property) !== undefined &&
        isPlainLiteral(ts, property.initializer),
    );
  }
  if (ts.isPrefixUnaryExpression(node)) {
    return ts.isNumericLiteral(node.operand);
  }
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined")
  );
}

function refusal(context: SourceContext, change: ConfigChange): CliError {
  const where = formatPath(change.path);
  const value = change.kind === "remove" ? undefined : change.value;
  let fix = `Edit ${where} in ${context.fileName} by hand`;
  if (change.kind === "remove") {
    fix = `Remove ${where} from ${context.fileName} by hand`;
  } else if (!isFunction(value)) {
    fix = `Set ${where} to ${JSON.stringify(value)} in ${context.fileName} by hand`;
  }
  return new CliError({
    title: `Cannot update ${where} in ${context.fileName}`,
    reason: NOT_A_LITERAL_REASON,
    fixes: [fix],
  });
}

function editFor(
  context: SourceContext,
  root: TypeScript.ObjectLiteralExpression,
  change: ConfigChange,
): SourceEdit {
  const { ts } = context;
  const parent = findObject(ts, root, change.path.slice(0, -1));
  const property =
    parent && findProperty(ts, parent, change.path[change.path.length - 1]);
  if (change.kind === "remove") {
    const spread = parent?.properties.some((member) =>
      ts.isSpreadAssignment(member),
    );
    if (!parent || !property || spread) throw refusal(context, change);
    return removalEdit(context, parent, property);
  }
  const value: ValueSource = {
    serialized: printNode(toNode(change.value), context.indentation),
    string: isString(change.value) ? change.value : undefined,
  };
  if (property && ts.isPropertyAssignment(property)) {
    const node = unwrapExpression(ts, property.initializer);
    if (!isPlainLiteral(ts, node)) throw refusal(context, change);
    return replacementEdit(context, node, value);
  }
  if (change.kind === "add" && parent && !property) {
    return insertionEdit(context, parent, change.path.at(-1) ?? "", value);
  }
  throw refusal(context, change);
}

function parseSource(
  ts: typeof TypeScript,
  fileName: string,
  source: string,
): TypeScript.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function configObject(
  ts: typeof TypeScript,
  sourceFile: TypeScript.SourceFile,
): TypeScript.ObjectLiteralExpression {
  const root = findConfigObject(ts, sourceFile);
  if (!root) {
    throw new CliError({ title: FUNCTION_BASED_TS_CONFIG_ERROR });
  }
  return root;
}

/** What {@link rewriteConfigSource} needs to edit a configuration file in place. */
export interface ConfigSourceRewrite {
  fileName: string;
  source: string;
  indentation: string;
  /** The configuration the file holds before the command's changes. */
  loadCurrent: () => Promise<object>;
  /** The configuration the command wants the file to hold. */
  target: Partial<AntelopeConfig>;
}

/**
 * Returns `source` with only the values that differ between the evaluated
 * file and `target` edited in place; every other byte is kept. Throws a
 * {@link CliError} naming the value when the change falls on source that is
 * not a plain literal, such as an environment read, a constant or a call.
 */
export async function rewriteConfigSource(
  ts: typeof TypeScript,
  request: ConfigSourceRewrite,
): Promise<string> {
  configObject(ts, parseSource(ts, request.fileName, request.source));
  const current = await request.loadCurrent();
  const { target } = request;
  if (!isPlainObject(current) || !isPlainObject(target)) {
    throw new CliError({ title: FUNCTION_BASED_TS_CONFIG_ERROR });
  }
  const newline = request.source.includes("\r\n") ? "\r\n" : "\n";
  return diffConfig(current, target).reduce((text, change) => {
    const sourceFile = parseSource(ts, request.fileName, text);
    const context: SourceContext = {
      ts,
      sourceFile,
      fileName: request.fileName,
      indentation: request.indentation,
      newline,
    };
    const edit = editFor(context, configObject(ts, sourceFile), change);
    return `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
  }, request.source);
}
