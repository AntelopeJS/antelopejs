import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { mkdirSync } from "node:fs";
import { stat, writeFile as writeFileNode } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  loadTsConfigFile,
  tryFindConfigPath,
  TS_CONFIG_FILE,
} from "../core/config";
import { NodeFileSystem } from "../core/filesystem";
import { rewriteConfigSource } from "./config-source";
import {
  decodeModulePackageJson,
  type ModulePackageJson,
} from "../core/modules";
import { CliError, getProcessUi } from "../core/output";
import type { IFileSystem } from "../types";
import { cloneValue, isObject, isString } from "../utils";
import { toConfigSource } from "./config-layout";

const DEFAULT_INDENTATION = "  ";
const DEFINE_CONFIG_IMPORT_LINE =
  'import { defineConfig } from "@antelopejs/interface-core/config";';

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
  } catch {}
  return DEFAULT_INDENTATION;
}

export const DEFAULT_GIT_REPO = "https://github.com/AntelopeJS/interfaces.git";

/**
 * The interface repository a command reads: its `--git` option or
 * `ANTELOPEJS_GIT`, else the `git` key of the user configuration.
 */
export async function resolveGit(options: { git?: string }): Promise<string> {
  return options.git || (await readUserConfig()).git;
}

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
  data: ModulePackageJson,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const indentation = await detectIndentation(filePath, fileSystem);
  await fileSystem.writeFile(
    filePath,
    `${JSON.stringify(data, null, indentation)}\n`,
  );
}

async function readTextFile(
  filePath: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string | undefined> {
  if (!(await fileSystem.exists(filePath))) {
    return undefined;
  }
  return fileSystem.readFileString(filePath);
}

function createTsConfigContent(
  data: Partial<AntelopeConfig>,
  indentation: string,
): string {
  const serialized = toConfigSource(data, indentation);
  return `${DEFINE_CONFIG_IMPORT_LINE}\n\nexport default defineConfig(${serialized});\n`;
}

const readSnapshots = new WeakMap<object, unknown>();

async function renderTsConfig(
  configPath: string,
  data: Partial<AntelopeConfig>,
  fileSystem: IFileSystem,
): Promise<string> {
  const ts = await import("typescript");
  const snapshot = readSnapshots.get(data);
  return rewriteConfigSource(ts, {
    fileName: path.basename(configPath),
    source: await fileSystem.readFileString(configPath),
    indentation: await detectIndentation(configPath, fileSystem),
    loadCurrent: async () =>
      isObject(snapshot)
        ? snapshot
        : loadTsConfigFile(configPath, undefined, true),
    target: data,
  });
}

async function writeNewTsConfig(
  project: string,
  data: Partial<AntelopeConfig>,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const configPath = path.join(project, TS_CONFIG_FILE);
  const content = createTsConfigContent(data, DEFAULT_INDENTATION);
  await fileSystem.writeFile(configPath, content);
}

/**
 * Writes `data` to the project's configuration file. An existing file is
 * edited in place: only the values that differ from what {@link readConfig}
 * returned for `data` change, and a change that falls on an expression throws
 * a {@link CliError} without writing.
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
  const content = await renderTsConfig(configPath, data, fileSystem);
  await fileSystem.writeFile(configPath, content);
  readSnapshots.set(data, cloneValue(data));
}

/**
 * Throws the {@link CliError} that {@link writeConfig} would throw for `data`,
 * without writing, so a command can refuse before its other side effects.
 */
export async function assertConfigWritable(
  project: string,
  data: Partial<AntelopeConfig>,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const configPath = await tryFindConfigPath(project, fileSystem);
  if (configPath) {
    await renderTsConfig(configPath, data, fileSystem);
  }
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
  const config = await loadTsConfigFile(configPath, environment);
  if (!readSnapshots.has(config)) {
    readSnapshots.set(config, cloneValue(config));
  }
  return config;
}

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
  const text = await readTextFile(
    path.join(module, "package.json"),
    fileSystem,
  );
  const parsed: unknown = text === undefined ? null : JSON.parse(text);
  return text === undefined || parsed === null
    ? undefined
    : decodeModulePackageJson(text, module);
}

export interface UserConfig {
  git: string;
}

/**
 * Decodes the CLI's own `config.json`. `null` holds the defaults; any other
 * content that is not an object with a string `git` is refused, since only
 * `ajs config` writes this file.
 *
 * @param text - The text of the file.
 * @param where - The file named by a refusal.
 */
export function decodeUserConfig(text: string, where: string): UserConfig {
  const content: unknown = JSON.parse(text);
  if (content === null) {
    return getDefaultUserConfig();
  }
  if (!isObject(content) || !isString(content.git)) {
    throw new CliError({
      title: `Invalid CLI configuration in ${where}`,
      reason: "The file must hold an object whose git value is a string.",
      fixes: ["Run ajs config reset to write the default configuration"],
    });
  }
  return { ...content, git: content.git };
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
  const text = await readTextFile(configPath, new NodeFileSystem());
  return text === undefined
    ? getDefaultUserConfig()
    : decodeUserConfig(text, configPath);
}
