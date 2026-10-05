import path from "node:path";
import type * as TypeScript from "typescript";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { stat, writeFile as writeFileNode } from "node:fs/promises";
import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import { CliError, getProcessUi } from "./output";
import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import { loadTsConfigFile } from "../config/config-loader";
import type { ModulePackageJson } from "../module-manifest";
import { TS_CONFIG_FILE, tryFindConfigPath } from "../config/config-paths";

const DEFAULT_INDENTATION = "  ";
const DEFINE_CONFIG_IMPORT_LINE =
  "import { defineConfig } from '@antelopejs/interface-core/config';";
const FUNCTION_BASED_TS_CONFIG_ERROR =
  "Cannot update antelope.config.ts automatically when default export is function-based.";

interface TsConfigWriteMeta {
  canWrite: boolean;
  useDefineConfig: boolean;
}

/**
 * Detects the indentation character from a file
 * @param filePath Path to the file
 * @returns The detected indentation character or default (2 spaces)
 */
export async function detectIndentation(
  filePath: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  try {
    const content = await fileSystem.readFileString(filePath);
    const match = content.match(/\n([\t ]+)/);

    if (match?.[1]) {
      const firstChar = match[1][0];
      return firstChar === "\t" ? "\t" : "  ";
    }
  } catch {
    //
  }
  return DEFAULT_INDENTATION;
}

// Definition of the default git repository
export const DEFAULT_GIT_REPO = "https://github.com/AntelopeJS/interfaces.git";

// Utility function to display warning for non-default git repositories
export function displayNonDefaultGitWarning(gitUrl: string): void {
  if (gitUrl !== DEFAULT_GIT_REPO) {
    getProcessUi().message("warn", "Using a non-default git repository", {
      detail:
        "Its interfaces are not official and may not adhere to community quality standards or best practices.",
    });
  }
}

async function writeJsonFile(
  filePath: string,
  data: unknown,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const indentation = await detectIndentation(filePath, fileSystem);
  await fileSystem.writeFile(
    filePath,
    `${JSON.stringify(data, null, indentation)}\n`,
  );
}

async function readJsonFile<T>(
  filePath: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<T | undefined> {
  if (!(await fileSystem.exists(filePath))) {
    return undefined;
  }
  return JSON.parse(await fileSystem.readFileString(filePath));
}

function getDefaultExportExpression(
  ts: typeof TypeScript,
  sourceFile: TypeScript.SourceFile,
): TypeScript.Expression | undefined {
  const exportAssignment = sourceFile.statements.find(
    (statement): statement is TypeScript.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  return exportAssignment?.expression;
}

function isDefineConfigCall(
  ts: typeof TypeScript,
  expression: TypeScript.Expression,
): expression is TypeScript.CallExpression {
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "defineConfig"
  );
}

function unwrapDefineConfigExpression(
  ts: typeof TypeScript,
  expression: TypeScript.Expression,
): TypeScript.Expression {
  if (
    !isDefineConfigCall(ts, expression) ||
    expression.arguments.length === 0
  ) {
    return expression;
  }
  return expression.arguments[0];
}

async function getTsConfigWriteMeta(
  configPath: string,
  source: string,
): Promise<TsConfigWriteMeta> {
  const ts = await import("typescript");
  const sourceFile = ts.createSourceFile(
    configPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const expression = getDefaultExportExpression(ts, sourceFile);
  if (!expression) {
    return { canWrite: false, useDefineConfig: false };
  }
  const useDefineConfig = isDefineConfigCall(ts, expression);
  const targetExpression = unwrapDefineConfigExpression(ts, expression);
  return {
    canWrite: ts.isObjectLiteralExpression(targetExpression),
    useDefineConfig,
  };
}

const SAFE_KEY_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function serializeToJs(value: unknown, indent: string, depth: number): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    return String(value);
  }
  const currentIndent = indent.repeat(depth);
  const nextIndent = indent.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map(
      (item) => `${nextIndent}${serializeToJs(item, indent, depth + 1)}`,
    );
    return `[\n${items.join(",\n")}\n${currentIndent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const props = entries.map(([key, val]) => {
    const formattedKey = SAFE_KEY_RE.test(key) ? key : JSON.stringify(key);
    return `${nextIndent}${formattedKey}: ${serializeToJs(val, indent, depth + 1)}`;
  });
  return `{\n${props.join(",\n")}\n${currentIndent}}`;
}

function createTsConfigContent(
  data: Partial<AntelopeConfig>,
  indentation: string,
  useDefineConfig: boolean,
): string {
  const serialized = serializeToJs(data, indentation, 0);
  if (!useDefineConfig) {
    return `export default ${serialized};\n`;
  }
  return `${DEFINE_CONFIG_IMPORT_LINE}\n\nexport default defineConfig(${serialized});\n`;
}

async function writeTsConfig(
  configPath: string,
  data: Partial<AntelopeConfig>,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const source = await fileSystem.readFileString(configPath);
  const writeMeta = await getTsConfigWriteMeta(configPath, source);
  if (!writeMeta.canWrite) {
    throw new CliError({ title: FUNCTION_BASED_TS_CONFIG_ERROR });
  }
  const indentation = await detectIndentation(configPath, fileSystem);
  const content = createTsConfigContent(
    data,
    indentation,
    writeMeta.useDefineConfig,
  );
  await fileSystem.writeFile(configPath, content);
}

async function writeNewTsConfig(
  project: string,
  data: Partial<AntelopeConfig>,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const configPath = path.join(project, TS_CONFIG_FILE);
  const content = createTsConfigContent(data, DEFAULT_INDENTATION, true);
  await fileSystem.writeFile(configPath, content);
}

/*
 * AntelopeJS configuration
 */
export async function writeConfig(
  project: string,
  data: Partial<AntelopeConfig>,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const configPath = await tryFindConfigPath(project, fileSystem);
  if (!configPath) {
    await writeNewTsConfig(project, data, fileSystem);
    return;
  }
  await writeTsConfig(configPath, data, fileSystem);
}

export async function readConfig(
  project: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
  environment?: string,
): Promise<AntelopeConfig | undefined> {
  const configPath = await tryFindConfigPath(project, fileSystem);

  if (!configPath) {
    return undefined;
  }
  return loadTsConfigFile(configPath, environment);
}

/*
 * Node package configuration
 */
export async function writeModuleManifest(
  module: string,
  data: ModulePackageJson,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  await writeJsonFile(path.join(module, "package.json"), data, fileSystem);
}

export async function readModuleManifest(
  module: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<ModulePackageJson | undefined> {
  return readJsonFile<ModulePackageJson>(
    path.join(module, "package.json"),
    fileSystem,
  );
}

/*
 * User configuration
 */
export interface UserConfig {
  git: string;
}

export function getDefaultUserConfig(): UserConfig {
  return {
    git: DEFAULT_GIT_REPO,
  };
}

export async function writeUserConfig(data: UserConfig): Promise<void> {
  const folderPath = path.join(homedir(), ".antelopejs");
  const configPath = path.join(folderPath, "config.json");
  if (!(await stat(folderPath).catch(() => false))) {
    mkdirSync(folderPath, { recursive: true });
  }
  const indentation = await detectIndentation(configPath, new NodeFileSystem());
  await writeFileNode(
    configPath,
    `${JSON.stringify(data, null, indentation)}\n`,
  );
}

export async function readUserConfig(): Promise<UserConfig> {
  const configPath = path.join(homedir(), ".antelopejs", "config.json");
  if (!(await stat(configPath).catch(() => false))) {
    return getDefaultUserConfig();
  }
  const config = await readJsonFile<UserConfig>(
    configPath,
    new NodeFileSystem(),
  );
  return config ?? getDefaultUserConfig();
}
