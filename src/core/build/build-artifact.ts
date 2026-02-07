import crypto from 'crypto';
import path from 'path';
import { AntelopeLogging, IFileSystem, ModuleSource } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { ModulePackageJson } from '../module-manifest';

const BUILD_ARTIFACT_VERSION = '1';
const BUILD_FOLDER = '.antelope/build';
const BUILD_FILE = 'build.json';
const HASH_SEPARATOR = '\n--antelope-build-hash--\n';
const MAIN_CONFIG_FILE = 'antelope.json';
const MODULE_CONFIG_PREFIX = 'antelope.';
const MODULE_CONFIG_SUFFIX = '.json';
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
  modules?: Record<string, unknown>;
}

function resolveProjectFolder(projectFolder: string): string {
  return path.resolve(projectFolder);
}

function getMainConfigPath(projectFolder: string): string {
  return path.join(resolveProjectFolder(projectFolder), MAIN_CONFIG_FILE);
}

function getModuleConfigPath(projectFolder: string, moduleName: string): string {
  return path.join(resolveProjectFolder(projectFolder), `${MODULE_CONFIG_PREFIX}${moduleName}${MODULE_CONFIG_SUFFIX}`);
}

function getSortedModuleNames(modules?: Record<string, unknown>): string[] {
  if (!modules) {
    return [];
  }
  return Object.keys(modules).sort((a, b) => a.localeCompare(b));
}

export function getBuildFolderPath(projectFolder: string): string {
  return path.join(resolveProjectFolder(projectFolder), BUILD_FOLDER);
}

export function getBuildArtifactPath(projectFolder: string): string {
  return path.join(getBuildFolderPath(projectFolder), BUILD_FILE);
}

export async function computeConfigHash(
  projectFolder: string,
  env: string,
  fs: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  const configPath = getMainConfigPath(projectFolder);
  const configContent = await fs.readFileString(configPath, 'utf-8');
  const rawConfig = JSON.parse(configContent) as RawProjectConfig;
  const moduleNames = getSortedModuleNames(rawConfig.modules);
  const hashParts: string[] = [configContent];

  for (const moduleName of moduleNames) {
    const moduleConfigPath = getModuleConfigPath(projectFolder, moduleName);
    if (await fs.exists(moduleConfigPath)) {
      hashParts.push(await fs.readFileString(moduleConfigPath, 'utf-8'));
    }
  }

  hashParts.push(env);

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
