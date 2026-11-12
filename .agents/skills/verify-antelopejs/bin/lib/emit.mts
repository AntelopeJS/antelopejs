import { spawnSync } from "node:child_process";
import { dirname, extname, posix } from "node:path";
import ts from "typescript";

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

function isPropertyName(node: ts.Identifier): boolean {
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

/** The covered files: their module keys, and the names of their top-level function declarations, which move freely between them. */
interface Covered {
  modules: Set<string>;
  functions: Set<string>;
}

/** Where each value-imported binding of a file comes from, and the entries that are not statements: `entries` may move freely, `ordered` keep their order in the file. */
interface Origins {
  bindings: Map<string, string>;
  entries: EmitItem[];
  ordered: EmitItem[];
}

/**
 * A binding from a covered module is its name alone when it is a function
 * declaration, which may move between covered files, and `module#name`
 * otherwise, so a variable or class of one file never reads as one of the same
 * name in another.
 */
function bindingOrigin(covered: Covered, module: string, name: string): string {
  return covered.modules.has(module) && covered.functions.has(name)
    ? name
    : `${module}#${name}`;
}

function importedBindings(
  clause: ts.ImportClause,
  module: string,
  covered: Covered,
): [string, string][] {
  const named = clause.namedBindings;
  const bindings: [string, string][] = [];
  if (clause.name)
    bindings.push([
      clause.name.text,
      bindingOrigin(covered, module, "default"),
    ]);
  if (named && ts.isNamespaceImport(named))
    bindings.push([named.name.text, bindingOrigin(covered, module, "*")]);
  if (named && ts.isNamedImports(named))
    for (const element of named.elements)
      bindings.push([
        element.name.text,
        bindingOrigin(
          covered,
          module,
          (element.propertyName ?? element.name).text,
        ),
      ]);
  return bindings;
}

function reexportTexts(
  statement: ts.ExportDeclaration,
  module: string,
  covered: Covered,
): string[] {
  const exported = statement.exportClause;
  const inside = covered.modules.has(module);
  if (exported === undefined) return inside ? [] : [`export * from ${module}`];
  if (ts.isNamespaceExport(exported))
    return inside ? [] : [`export * as ${exported.name.text} from ${module}`];
  return exported.elements.flatMap((element) => {
    const origin = bindingOrigin(
      covered,
      module,
      (element.propertyName ?? element.name).text,
    );
    return origin === element.name.text
      ? []
      : [`export ${origin} as ${element.name.text}`];
  });
}

/**
 * The exports of a file that name a local or imported binding, keyed by the
 * origin of what they export. An export under its own name of a local needs no
 * entry, the same as an `export` keyword, so only a renamed local and any
 * imported binding does.
 */
function localExportTexts(
  statement: ts.ExportDeclaration,
  bindings: Map<string, string>,
  locals: Map<string, string>,
): string[] {
  const exported = statement.exportClause;
  if (exported === undefined || !ts.isNamedExports(exported)) return [];
  return exported.elements.flatMap((element) => {
    const name = (element.propertyName ?? element.name).text;
    const imported = bindings.get(name);
    const origin = imported ?? locals.get(name) ?? name;
    const own = imported === undefined && name === element.name.text;
    return own || origin === element.name.text
      ? []
      : [`export ${origin} as ${element.name.text}`];
  });
}

/**
 * Where each value-imported binding of a file comes from: the resolved
 * module and the imported name, so an alias or a swapped specifier changes
 * what a use refers to. A binding from a covered module is its name alone
 * when it is a function declaration, so moving the declaration between
 * covered files keeps every use the same; any other binding is keyed by its
 * module. Side-effect imports keep their order in the file. Re-exports and
 * renamed or imported exports become entries keyed by the origin they export.
 */
function originsOf(
  path: string,
  covered: Covered,
  file: ts.SourceFile,
  locals: Map<string, string>,
): Origins {
  const bindings = new Map<string, string>();
  const texts: string[] = [];
  const ordered: string[] = [];
  const exports: ts.ExportDeclaration[] = [];
  for (const statement of file.statements) {
    if (
      !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
    )
      continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined && ts.isExportDeclaration(statement))
      exports.push(statement);
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const module = moduleKey(path, specifier.text);
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause === undefined) {
        ordered.push(`import ${module}`);
        continue;
      }
      for (const [name, origin] of importedBindings(
        statement.importClause,
        module,
        covered,
      ))
        bindings.set(name, origin);
    } else texts.push(...reexportTexts(statement, module, covered));
  }
  for (const statement of exports)
    texts.push(...localExportTexts(statement, bindings, locals));
  const item = (text: string, hoisted: boolean) => ({
    structure: text,
    text,
    hoisted,
  });
  return {
    bindings,
    entries: texts.map((text) => item(text, true)),
    ordered: ordered.map((text) => item(text, false)),
  };
}

function leafOf(node: ts.Node, bindings: Map<string, string>): string {
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

function dropped(node: ts.Node): boolean {
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
function structureOf(node: ts.Node, bindings: Map<string, string>): string {
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

/** One script of a covered file, transpiled to JavaScript and parsed. */
interface Script {
  path: string;
  file: ts.SourceFile;
}

function parseScript(path: string, source: string): Script {
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      experimentalDecorators: true,
    },
  });
  return {
    path,
    file: ts.createSourceFile(
      "emit.js",
      outputText,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    ),
  };
}

function declaredNames(name: ts.BindingName): string[] {
  return ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) =>
        ts.isOmittedExpression(element) ? [] : declaredNames(element.name),
      );
}

function isFunctionDeclaration(
  statement: ts.Statement,
): statement is ts.FunctionDeclaration & { name: ts.Identifier } {
  return (
    ts.isFunctionDeclaration(statement) &&
    Boolean(statement.body) &&
    statement.name !== undefined
  );
}

/** The top-level variables, classes and enums of a script, each keyed by its file and name: what a function moved into another file must not pick up by name. */
function localsOf(script: Script): Map<string, string> {
  const file = script.path.replace(MODULE_EXTENSION, "");
  const names = script.file.statements.flatMap((statement) => {
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.flatMap((declaration) =>
        declaredNames(declaration.name),
      );
    return (ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
      statement.name
      ? [statement.name.text]
      : [];
  });
  return new Map(names.map((name) => [name, `${file}#${name}`]));
}

function scriptItems(script: Script, covered: Covered): EmitItem[] {
  const locals = localsOf(script);
  const origins = originsOf(script.path, covered, script.file, locals);
  const inFunctions = new Map([...locals, ...origins.bindings]);
  const statements = script.file.statements
    .filter(
      (statement) =>
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement),
    )
    .map((statement) => {
      const hoisted =
        ts.isFunctionDeclaration(statement) && Boolean(statement.body);
      return {
        structure: structureOf(
          statement,
          hoisted ? inFunctions : origins.bindings,
        ),
        text: readable(statement.getText(script.file)),
        hoisted,
      };
    });
  return [...origins.entries, ...origins.ordered, ...statements];
}

/** A covered file as its scripts and the items that are not scripts: a Vue template, or the whole text of any other file. */
interface Parsed {
  path: string;
  scripts: Script[];
  others: EmitItem[];
}

function parsedFile(path: string, source: string): Parsed {
  if (path.endsWith(".vue")) {
    const template = /<template\b[^>]*>([\s\S]*)<\/template>/.exec(source);
    const markup = template ? template[1].replace(/\s+/g, " ").trim() : null;
    return {
      path,
      scripts: [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
        ([, body]) => parseScript(`${path}.ts`, body),
      ),
      others:
        markup === null
          ? []
          : [
              {
                structure: `template(${markup})`,
                text: readable(`<template> ${markup}`),
                hoisted: false,
              },
            ],
    };
  }
  if (CODE_EXTENSIONS.has(extname(path)))
    return { path, scripts: [parseScript(path, source)], others: [] };
  const flat = source.replace(/\s+/g, " ").trim();
  return {
    path,
    scripts: [],
    others: [
      { structure: `file(${flat})`, text: readable(flat), hoisted: false },
    ],
  };
}

/**
 * What the covered code does at a commit, as structure rather than text:
 * each covered file's top-level statements and side-effect imports in order,
 * and, apart, the function declarations and exports keyed by origin of every
 * covered file, which hoisting lets move freely. Each use of an imported
 * binding stands for its origin (resolved module and imported name), and a
 * function declaration refers to the top-level variables and classes of its
 * own file by file and name, so retargeting an import, an alias or an export,
 * or moving a function next to a different variable of the same name, changes
 * the fingerprint. Types, comments, formatting and export keywords are left
 * out, so a type-only edit, a reformat, or moving a function declaration to
 * another covered file keeps the same fingerprint, while reordering or moving
 * any other statement changes it.
 */
export function emitFingerprint(
  repo: string,
  sha: string,
  files: string[],
): EmitFingerprint {
  const fingerprint: EmitFingerprint = { functions: [], files: {} };
  const parsed = files.flatMap((path) => {
    const source = fileAt(repo, sha, path);
    return source === null ? [] : [parsedFile(path, source)];
  });
  const covered: Covered = {
    modules: new Set(files.map((path) => path.replace(MODULE_EXTENSION, ""))),
    functions: new Set(
      parsed.flatMap(({ scripts }) =>
        scripts.flatMap(({ file }) =>
          file.statements
            .filter(isFunctionDeclaration)
            .map(({ name }) => name.text),
        ),
      ),
    ),
  };
  for (const { path, scripts, others } of parsed) {
    const items = [
      ...scripts.flatMap((script) => scriptItems(script, covered)),
      ...others,
    ];
    fingerprint.functions.push(...items.filter((item) => item.hoisted));
    fingerprint.files[path] = items.filter((item) => !item.hoisted);
  }
  return fingerprint;
}
