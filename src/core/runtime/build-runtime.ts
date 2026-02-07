import path from 'path';
import { InterfaceConnectionRef } from '../interface-registry';
import { ModuleManifest } from '../module-manifest';
import { NodeFileSystem } from '../filesystem';
import {
  BuildArtifact,
  BuildImportOverride,
  BuildModuleEntry,
  computeConfigHash,
  createBuildArtifact,
  getBuildArtifactPath,
  readBuildArtifact,
  writeBuildArtifact,
} from '../build/build-artifact';
import { Logging } from '../../interfaces/logging/beta';
import { ModuleManifestEntry, ModuleOverrideMap, NormalizedLoadedConfig } from './runtime-types';

const STALE_BUILD_WARNING = `Configuration has changed since last build. Run 'ajs project build' to update.`;
const BUILD_MISSING_REBUILD_HINT = "Run 'ajs project build --env <env>' first.";

function mapBuildImportOverrides(overrides?: ModuleOverrideMap): BuildImportOverride[] | undefined {
  if (!overrides || overrides.size === 0) {
    return undefined;
  }

  const entries: BuildImportOverride[] = [];
  for (const [interfaceName, modules] of overrides.entries()) {
    modules.forEach(({ module, id }) => entries.push({ interface: interfaceName, source: module, id }));
  }

  return entries;
}

function mapArtifactImportOverrides(overrides?: BuildImportOverride[]): ModuleOverrideMap | undefined {
  if (!overrides || overrides.length === 0) {
    return undefined;
  }

  const mapped: ModuleOverrideMap = new Map();
  overrides.forEach((override) => {
    const entries = mapped.get(override.interface) ?? [];
    const entry: InterfaceConnectionRef = { module: override.source, id: override.id };
    entries.push(entry);
    mapped.set(override.interface, entries);
  });

  return mapped;
}

function serializeBuildModuleEntries(entries: ModuleManifestEntry[]): Record<string, BuildModuleEntry> {
  const modules: Record<string, BuildModuleEntry> = {};

  entries.forEach((entry) => {
    const manifest = entry.manifest.serialize();
    const importOverrides = mapBuildImportOverrides(entry.config.importOverrides);
    const disabledExports = entry.config.disabledExports ? Array.from(entry.config.disabledExports) : undefined;
    modules[entry.manifest.name] = {
      ...manifest,
      config: entry.config.config,
      importOverrides,
      disabledExports,
    };
  });

  return modules;
}

export function mapArtifactModuleEntries(artifact: BuildArtifact): ModuleManifestEntry[] {
  return Object.values(artifact.modules).map((entry) => {
    const importOverrides = mapArtifactImportOverrides(entry.importOverrides);
    return {
      manifest: ModuleManifest.fromBuildEntry(entry),
      config: {
        config: entry.config,
        importOverrides,
        disabledExports: new Set(entry.disabledExports ?? []),
      },
    };
  });
}

function createMissingBuildError(projectFolder: string): Error {
  const buildPath = path.relative(path.resolve(projectFolder), getBuildArtifactPath(projectFolder));
  const messagePath = buildPath && buildPath.length > 0 ? buildPath : '.antelope/build/build.json';
  return new Error(`No build found at ${messagePath}\n${BUILD_MISSING_REBUILD_HINT}`);
}

export async function readBuildArtifactOrThrow(projectFolder: string, fs: NodeFileSystem): Promise<BuildArtifact> {
  try {
    return await readBuildArtifact(projectFolder, fs);
  } catch {
    throw createMissingBuildError(projectFolder);
  }
}

export async function warnIfBuildIsStale(
  projectFolder: string,
  artifact: BuildArtifact,
  fs: NodeFileSystem,
): Promise<void> {
  try {
    const latestHash = await computeConfigHash(projectFolder, artifact.env, fs);
    if (latestHash !== artifact.configHash) {
      Logging.Warn(STALE_BUILD_WARNING);
    }
  } catch {
    Logging.Warn(STALE_BUILD_WARNING);
  }
}

export async function ensureBuildModulesExist(artifact: BuildArtifact, fs: NodeFileSystem): Promise<void> {
  const checks = Object.values(artifact.modules).map(async (entry) => {
    if (await fs.exists(entry.folder)) {
      return;
    }

    throw new Error(
      `Module '${entry.name}' not found at ${entry.folder}\n` +
        `The build artifact references files that no longer exist.\n` +
        `Run 'ajs project build' to rebuild.`,
    );
  });

  await Promise.all(checks);
}

export async function writeProjectBuildArtifact(
  normalizedConfig: NormalizedLoadedConfig,
  env: string,
  entries: ModuleManifestEntry[],
  fs: NodeFileSystem,
): Promise<void> {
  const configHash = await computeConfigHash(normalizedConfig.projectFolder, env, fs);
  const modules = serializeBuildModuleEntries(entries);

  const artifact = createBuildArtifact({
    configHash,
    env,
    config: {
      name: normalizedConfig.name,
      cacheFolder: normalizedConfig.cacheFolder,
      projectFolder: normalizedConfig.projectFolder,
      logging: normalizedConfig.logging,
      envOverrides: normalizedConfig.envOverrides,
    },
    modules,
  });

  await writeBuildArtifact(normalizedConfig.projectFolder, artifact, fs);
}
