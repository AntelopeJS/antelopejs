import crypto from 'crypto';
import path from 'path';
import { AntelopeLogging, IFileSystem, ModuleSource } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { ModulePackageJson } from '../module-manifest';
import { ConfigLoader } from '../config/config-loader';

const BUILD_ARTIFACT_VERSION = '1';
const BUILD_FOLDER = '.antelope/build';
const BUILD_FILE = 'build.json';
const HASH_SEPARATOR = '\n--antelope-build-hash--\n';
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
  source: string;
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
  version: string;
  main: string;
  manifest: ModulePackageJson;
  exports: Record<string, string>;
  imports: string[];
  baseUrl: string;
  paths: BuildPathEntry[];
  exportsPath: string;
  srcAliases?: BuildAliasEntry[];
  config?: unknown;
  importOverrides?: BuildImportOverride[];
  disabledExports?: string[];
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

interface RawProjectConfig {
  [key: string]: unknown;
}

function isRawProjectConfig(value: unknown): value is RawProjectConfig {
  return typeof value === 'object' && value !== null;
}

function toStableHashValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableHashValue(item));
  }
  if (!isRawProjectConfig(value)) {
    return value;
  }
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(keys.map((key) => [key, toStableHashValue(value[key])]));
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
  const loader = new ConfigLoader(fs);
  const resolvedConfig = await loader.load(projectFolder, env);
  const stableConfig = JSON.stringify(toStableHashValue(resolvedConfig));
  const hashParts: string[] = [stableConfig, env];

  return crypto.createHash('sha256').update(hashParts.join(HASH_SEPARATOR)).digest('hex');
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
  await fs.writeFile(artifactPath, JSON.stringify(artifact, null, JSON_INDENT) + '\n');
}

export async function readBuildArtifact(
  projectFolder: string,
  fs: IFileSystem = new NodeFileSystem(),
): Promise<BuildArtifact> {
  const artifactPath = getBuildArtifactPath(projectFolder);
  const content = await fs.readFileString(artifactPath, 'utf-8');
  return JSON.parse(content) as BuildArtifact;
}
