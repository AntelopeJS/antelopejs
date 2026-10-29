import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, extname, join, posix } from "node:path";
import type TypeScript from "typescript";

import { REPO_DIR } from "./run.mts";

let ts: typeof TypeScript;

/** One top-level item of a covered file: its structure decides equality, its text only describes it. */
export interface EmitItem {
  structure: string;
  text: string;
  hoisted: boolean;
}

/** What the covered code does at a commit: the function declarations of every covered file, and each file's other top-level items in order. */
export interface EmitFingerprint {
  functions: EmitItem[];
  files: Record<string, EmitItem[]>;
}

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
]);
const OUTPUT_LIMIT = 64 * 1024 * 1024;
const TEXT_LENGTH = 160;

function fileAt(repo: string, sha: string, path: string): string | null {
  const shown = spawnSync("git", ["show", `${sha}:${path}`], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: OUTPUT_LIMIT,
  });
  return shown.status === 0 ? shown.stdout : null;
}

const MODULE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/;

function moduleKey(path: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return posix.join(dirname(path), specifier).replace(MODULE_EXTENSION, "");
}

function isPropertyName(node: TypeScript.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessor(parent) ||
      ts.isSetAccessor(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  );
}

/** Where each value-imported binding of a file comes from, and the entries that are not statements. */
interface Origins {
  bindings: Map<string, string>;
  entries: EmitItem[];
}

function bindingOrigin(
  covered: Set<string>,
  module: string,
  name: string,
): string {
  return covered.has(module) && name !== "default" && name !== "*"
    ? name
    : `${module}#${name}`;
}

function importedBindings(
  clause: TypeScript.ImportClause,
  module: string,
  covered: Set<string>,
): [string, string][] {
  const named = clause.namedBindings;
  const bindings: [string, string][] = [];
  if (clause.name)
    bindings.push([clause.name.text, bindingOrigin(covered, module, "default")]);
  if (named && ts.isNamespaceImport(named))
    bindings.push([named.name.text, bindingOrigin(covered, module, "*")]);
  if (named && ts.isNamedImports(named))
    for (const element of named.elements)
      bindings.push([
        element.name.text,
        bindingOrigin(covered, module, (element.propertyName ?? element.name).text),
      ]);
  return bindings;
}

function reexportTexts(
  statement: TypeScript.ExportDeclaration,
  module: string,
): string[] {
  const exported = statement.exportClause;
  if (exported === undefined) return [`export * from ${module}`];
  if (ts.isNamespaceExport(exported))
    return [`export * as ${exported.name.text} from ${module}`];
  return exported.elements.map(
    (element) =>
      `export ${module}#${(element.propertyName ?? element.name).text} as ${element.name.text}`,
  );
}

/**
 * Where each value-imported binding of a file comes from: the resolved
 * module and the imported name, so an alias or a swapped specifier changes
 * what a use refers to. A binding from a covered module is its imported
 * name alone, the same as a local declaration of it, so moving a
 * declaration between covered files keeps every use the same. Side-effect
 * imports and re-exports of uncovered modules become entries of their own.
 */
function originsOf(
  path: string,
  covered: Set<string>,
  file: TypeScript.SourceFile,
): Origins {
  const bindings = new Map<string, string>();
  const texts: string[] = [];
  for (const statement of file.statements) {
    if (
      !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
    )
      continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const module = moduleKey(path, specifier.text);
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause === undefined) {
        texts.push(`import ${module}`);
        continue;
      }
      for (const [name, origin] of importedBindings(statement.importClause, module, covered))
        bindings.set(name, origin);
    } else if (!covered.has(module)) {
      texts.push(...reexportTexts(statement, module));
    }
  }
  const entries = texts.map((text) => ({ structure: text, text, hoisted: true }));
  return { bindings, entries };
}

function leafOf(node: TypeScript.Node, bindings: Map<string, string>): string {
  if (ts.isIdentifier(node))
    return isPropertyName(node)
      ? node.text
      : (bindings.get(node.text) ?? node.text);
  if (ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isNumericLiteral(node)) return String(Number(node.text));
  if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node))
    return JSON.stringify(node.text);
  if (ts.isBigIntLiteral(node) || ts.isRegularExpressionLiteral(node))
    return node.text;
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    return ts.SyntaxKind[node.operator];
  if (ts.isVariableDeclarationList(node))
    return String(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const));
  if (ts.isMetaProperty(node)) return ts.SyntaxKind[node.keywordToken];
  return "";
}

function dropped(node: TypeScript.Node): boolean {
  return (
    node.kind === ts.SyntaxKind.ExportKeyword ||
    node.kind === ts.SyntaxKind.DefaultKeyword
  );
}

/**
 * The structure of a node: its kind, its identifier name or literal value,
 * and its children's structure, with parentheses, positions, trivia, quote
 * style and line breaks left out, so formatting never changes it. An
 * imported binding stands for its origin.
 */
function structureOf(node: TypeScript.Node, bindings: Map<string, string>): string {
  if (ts.isParenthesizedExpression(node))
    return structureOf(node.expression, bindings);
  const children: string[] = [];
  ts.forEachChild(node, (child) => {
    if (!dropped(child)) children.push(structureOf(child, bindings));
  });
  return `${ts.SyntaxKind[node.kind]}(${leafOf(node, bindings)}|${children.join(",")})`;
}

function readable(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TEXT_LENGTH ? `${flat.slice(0, TEXT_LENGTH)}…` : flat;
}

function scriptItems(
  path: string,
  source: string,
  covered: Set<string>,
): EmitItem[] {
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      experimentalDecorators: true,
    },
  });
  const file = ts.createSourceFile(
    "emit.js",
    outputText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const { bindings, entries } = originsOf(path, covered, file);
  const statements = file.statements
    .filter(
      (statement) =>
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement),
    )
    .map((statement) => ({
      structure: structureOf(statement, bindings),
      text: readable(statement.getText(file)),
      hoisted: ts.isFunctionDeclaration(statement) && Boolean(statement.body),
    }));
  return [...entries, ...statements];
}

function vueItems(
  path: string,
  source: string,
  covered: Set<string>,
): EmitItem[] {
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  const template = /<template\b[^>]*>([\s\S]*)<\/template>/.exec(source);
  const markup = template ? template[1].replace(/\s+/g, " ").trim() : null;
  return [
    ...scripts.flatMap(([, body]) => scriptItems(`${path}.ts`, body, covered)),
    ...(markup === null
      ? []
      : [
          {
            structure: `template(${markup})`,
            text: readable(`<template> ${markup}`),
            hoisted: false,
          },
        ]),
  ];
}

function itemsOf(
  path: string,
  source: string,
  covered: Set<string>,
): EmitItem[] {
  if (path.endsWith(".vue")) return vueItems(path, source, covered);
  if (CODE_EXTENSIONS.has(extname(path)))
    return scriptItems(path, source, covered);
  const flat = source.replace(/\s+/g, " ").trim();
  return [{ structure: `file(${flat})`, text: readable(flat), hoisted: false }];
}

/**
 * What the covered code does at a commit, as structure rather than text:
 * each covered file's top-level statements in order, and, apart, the
 * function declarations, side-effect imports and re-exports of every covered
 * file, which hoisting lets move freely. Each use of an imported binding
 * stands for its origin (resolved module and imported name), so retargeting
 * an import or an alias changes the fingerprint. Types, comments, formatting
 * and export keywords are left out, so a type-only edit, a reformat, or
 * moving a function declaration to another covered file keeps the same
 * fingerprint, while reordering or moving any other statement changes it.
 */
export function emitFingerprint(
  repo: string,
  sha: string,
  files: string[],
): EmitFingerprint {
  ts = createRequire(join(REPO_DIR, "package.json"))("typescript");
  const fingerprint: EmitFingerprint = { functions: [], files: {} };
  const covered = new Set(
    files.map((path) => path.replace(MODULE_EXTENSION, "")),
  );
  for (const path of files) {
    const source = fileAt(repo, sha, path);
    if (source === null) continue;
    const items = itemsOf(path, source, covered);
    fingerprint.functions.push(...items.filter((item) => item.hoisted));
    fingerprint.files[path] = items.filter((item) => !item.hoisted);
  }
  return fingerprint;
}
