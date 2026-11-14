import type {
  AntelopeLogging,
  ModuleSource,
} from "@antelopejs/interface-core/config";
import crypto from "node:crypto";
import path from "node:path";

import type { IFileSystem } from "../../types";
import {
  ConfigLoader,
  importOverrideCheck,
  type LoadedConfig,
  loggingCheck,
} from "../config";
import { NodeFileSystem } from "../filesystem";
import {
  decodeModulePackageJson,
  type ModulePackageJson,
} from "./module-package-json";
import {
  anyValue,
  type FieldCheck,
  flag,
  isObjectOrNull,
  isString,
  leaf,
  listOf,
  mapOf,
  number,
  optional,
  section,
  text,
  textOrList,
  texts,
} from "../../utils";

const BUILD_ARTIFACT_VERSION = "1";
const BUILD_FOLDER = ".antelope/build";
const BUILD_FILE = "build.json";
const HASH_SEPARATOR = "\n--antelope-build-hash--\n";
const JSON_INDENT = 2;

export interface BuildPathEntry {
  key: string;
  values: string[];
}

export interface BuildAliasEntry {
  alias: string;
  replace: string;
}

export interface BuildImportOverride {
  interface: string;
  source?: string;
  id?: string;
}

export interface BuildArtifactConfig {
  name: string;
  cacheFolder: string;
  projectFolder: string;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
}

export interface BuildModuleEntry {
  folder: string;
  source: ModuleSource;
  name: string;
  version?: string;
  main: string;
  manifest: ModulePackageJson;
  implements?: string[];
  baseUrl: string;
  paths: BuildPathEntry[];
  srcAliases?: BuildAliasEntry[];
  config?: unknown;
  importOverrides?: BuildImportOverride[];
  disabledExports?: string[];
  exportPriority?: Record<string, number>;
  optional?: boolean;
}

export interface BuildArtifact {
  version: string;
  buildTime: string;
  configHash: string;
  env: string;
  config: BuildArtifactConfig;
  modules: Record<string, BuildModuleEntry>;
}

export interface BuildArtifactInput {
  configHash: string;
  env: string;
  config: BuildArtifactConfig;
  modules: Record<string, BuildModuleEntry>;
  buildTime?: string;
}

function isRawProjectConfig(value: unknown): value is Record<string, unknown> {
  return isObjectOrNull(value) && value !== null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- walks the resolved project config, whose module config is any JS value (docs/2.concepts/4.configuration.md, Referencing), or a module source: maps arrays, rebuilds every other object, a RegExp, a Date or a class instance included, from its own enumerable keys in sorted order, and returns functions and primitives as they are
function toStableHashValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableHashValue(item));
  }
  if (!isRawProjectConfig(value)) {
    return value;
  }
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(
    keys.map((key) => [key, toStableHashValue(value[key])]),
  );
}

/**
 * Serialise a value with object keys sorted, so equal values always produce
 * the same string whatever their key insertion order.
 */
export function toStableJson(value: LoadedConfig | ModuleSource): string {
  return JSON.stringify(toStableHashValue(value));
}

export function getBuildFolderPath(projectFolder: string): string {
  return path.join(path.resolve(projectFolder), BUILD_FOLDER);
}

export function getBuildArtifactPath(projectFolder: string): string {
  return path.join(getBuildFolderPath(projectFolder), BUILD_FILE);
}

export async function computeConfigHash(
  projectFolder: string,
  env: string,
  fs: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  return hashResolvedConfig(await loadBuildConfig(projectFolder, env, fs), env);
}

/**
 * Whether an override path decides what a build downloads and where: the
 * project `name`, its `cacheFolder`, or a module `source`.
 */
function isBuildInput(overridePath: string): boolean {
  const segments = overridePath.split(".");
  return (
    overridePath === "name" ||
    overridePath === "cacheFolder" ||
    (segments[0] === "modules" && segments[2] === "source")
  );
}

/**
 * Resolves `antelope.config.ts` for `env` the way a build stores it. An
 * `envOverrides` path that decides what the build downloads reads the build
 * environment; every other path is read as unset, so its value never reaches
 * `build.json`. `ajs project start` applies those.
 */
export function loadBuildConfig(
  projectFolder: string,
  env: string,
  fs: IFileSystem = new NodeFileSystem(),
): Promise<LoadedConfig> {
  return new ConfigLoader(fs).load(
    projectFolder,
    env,
    undefined,
    (name, overridePath) =>
      isBuildInput(overridePath) ? process.env[name] : undefined,
  );
}

/**
 * Hash a configuration already resolved by the {@link ConfigLoader} the way
 * {@link computeConfigHash} does, for callers that loaded it themselves.
 */
export function hashResolvedConfig(
  resolvedConfig: LoadedConfig,
  env: string,
): string {
  const hashParts: string[] = [toStableJson(resolvedConfig), env];

  return crypto
    .createHash("sha256")
    .update(hashParts.join(HASH_SEPARATOR))
    .digest("hex");
}

export function createBuildArtifact(params: BuildArtifactInput): BuildArtifact {
  return {
    version: BUILD_ARTIFACT_VERSION,
    buildTime: params.buildTime ?? new Date().toISOString(),
    configHash: params.configHash,
    env: params.env,
    config: params.config,
    modules: params.modules,
  };
}

export async function writeBuildArtifact(
  projectFolder: string,
  artifact: BuildArtifact,
  fs: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const buildFolder = getBuildFolderPath(projectFolder);
  const artifactPath = getBuildArtifactPath(projectFolder);
  await fs.rm(buildFolder, { recursive: true, force: true });
  await fs.mkdir(buildFolder, { recursive: true });
  await fs.writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, JSON_INDENT)}\n`,
  );
}

/** A module entry as `build.json` stores it, its manifest not yet decoded. */
interface StoredModuleEntry extends Omit<BuildModuleEntry, "manifest"> {
  manifest?: unknown;
}

interface StoredArtifact extends Omit<BuildArtifact, "modules"> {
  modules: Record<string, StoredModuleEntry>;
}

const MODULE_SOURCE_TYPES = new Set([
  "local",
  "git",
  "package",
  "local-folder",
]);

function isModuleSourceType(value: unknown): value is ModuleSource["type"] {
  return isString(value) && MODULE_SOURCE_TYPES.has(value);
}

const storedModuleEntry = section<StoredModuleEntry>("a build module entry", {
  folder: text,
  source: section<ModuleSource>("a module source", {
    type: leaf("a module source type", isModuleSourceType),
    id: optional(text),
    ignoreCache: optional(flag),
  }),
  name: text,
  version: optional(text),
  main: text,
  manifest: anyValue,
  implements: optional(texts),
  baseUrl: text,
  paths: listOf(
    "a list of path entries",
    section<BuildPathEntry>("a path entry", { key: text, values: texts }),
  ),
  srcAliases: optional(
    listOf(
      "a list of source aliases",
      section<BuildAliasEntry>("a source alias", {
        alias: text,
        replace: text,
      }),
    ),
  ),
  config: anyValue,
  importOverrides: optional(
    listOf("a list of import overrides", importOverrideCheck),
  ),
  disabledExports: optional(texts),
  exportPriority: optional(mapOf("a map of export priorities", number)),
  optional: optional(flag),
});

const storedArtifact: FieldCheck<StoredArtifact> = section("a build artifact", {
  version: text,
  buildTime: text,
  configHash: text,
  env: text,
  config: section<BuildArtifactConfig>("a build configuration", {
    name: text,
    cacheFolder: text,
    projectFolder: text,
    logging: optional(loggingCheck),
    envOverrides: mapOf("a map of environment overrides", textOrList),
  }),
  modules: mapOf("a map of build module entries", storedModuleEntry),
});

/**
 * Reads `build.json` back. The build wrote it, but it can be edited or come
 * from another core: a document whose fields do not hold their declared types
 * is refused with a {@link FieldError}, and each module's manifest goes through
 * the same decoder as a module's `package.json`.
 */
export async function readBuildArtifact(
  projectFolder: string,
  fs: IFileSystem = new NodeFileSystem(),
): Promise<BuildArtifact> {
  const artifactPath = getBuildArtifactPath(projectFolder);
  const content = await fs.readFileString(artifactPath, "utf-8");
  const stored: unknown = JSON.parse(content);
  storedArtifact(stored, "");
  const modules = Object.entries(stored.modules).map(
    ([id, entry]): [string, BuildModuleEntry] => [
      id,
      {
        ...entry,
        manifest: decodeModulePackageJson(
          JSON.stringify(entry.manifest),
          entry.folder,
        ),
      },
    ],
  );
  return { ...stored, modules: Object.fromEntries(modules) };
}
