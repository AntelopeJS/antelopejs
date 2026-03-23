import * as path from "node:path";
import type { ModuleSource } from "@antelopejs/interface-core/config";
import type { IFileSystem } from "../types";
import type {
  BuildAliasEntry,
  BuildModuleEntry,
  BuildPathEntry,
} from "./build/build-artifact";
import { NodeFileSystem } from "./filesystem";

export interface ModulePackageJson {
  name: string;
  version: string;
  description?: string;
  author?: string | string[];

  dependencies?: Record<string, string>;

  antelopeJs?: {
    implements?: string[];

    baseUrl?: string;
    paths?: Record<string, string[]>;

    moduleAliases?: Record<string, string>;

    defaultConfig?: Record<string, unknown>;
  };

  _moduleAliases?: Record<string, string>;
}

export interface PathMapping {
  key: string;
  values: string[];
}

export interface ModuleAliasEntry {
  alias: string;
  replace: string;
}

interface ModuleManifestState {
  main: string;
  baseUrl: string;
  paths: PathMapping[];
  implements: string[];
  srcAliases?: ModuleAliasEntry[];
}

interface ModuleSourceWithMain extends ModuleSource {
  main?: string;
}

function clonePathEntries(
  entries: BuildPathEntry[] | PathMapping[],
): PathMapping[] {
  return entries.map((entry) => ({
    key: entry.key,
    values: [...entry.values],
  }));
}

function cloneAliasEntries(
  entries?: BuildAliasEntry[] | ModuleAliasEntry[],
): ModuleAliasEntry[] | undefined {
  if (!entries) {
    return undefined;
  }
  return entries.map((entry) => ({
    alias: entry.alias,
    replace: entry.replace,
  }));
}

function resolveMainPath(folder: string, source: ModuleSource): string {
  const mainCandidate = (source as ModuleSourceWithMain).main;
  return typeof mainCandidate === "string"
    ? path.join(folder, mainCandidate)
    : folder;
}

function resolvePathMappings(
  baseUrl: string,
  manifest: ModulePackageJson,
): PathMapping[] {
  if (!manifest.antelopeJs?.paths) {
    return [];
  }

  return Object.entries(manifest.antelopeJs.paths).map(([key, values]) => ({
    key: key.replace(/\*$/, ""),
    values: values.map((value) => path.join(baseUrl, value.replace(/\*$/, ""))),
  }));
}

function resolveAliasEntries(
  folder: string,
  manifest: ModulePackageJson,
): ModuleAliasEntry[] | undefined {
  const rootAliases = manifest._moduleAliases
    ? Object.entries(manifest._moduleAliases).map(([alias, replace]) => ({
        alias,
        replace: path.join(folder, replace),
      }))
    : [];

  const antelopeAliases = manifest.antelopeJs?.moduleAliases
    ? Object.entries(manifest.antelopeJs.moduleAliases).map(
        ([alias, replace]) => ({
          alias,
          replace: path.join(folder, replace),
        }),
      )
    : [];

  const aliases = [...rootAliases, ...antelopeAliases];
  return aliases.length > 0 ? aliases : undefined;
}

function createManifestState(
  folder: string,
  source: ModuleSource,
  manifest: ModulePackageJson,
): ModuleManifestState {
  const implementedInterfaces = manifest.antelopeJs?.implements ?? [];
  const baseUrl = path.join(folder, manifest.antelopeJs?.baseUrl ?? "");

  return {
    main: resolveMainPath(folder, source),
    baseUrl,
    paths: resolvePathMappings(baseUrl, manifest),
    implements: [...implementedInterfaces],
    srcAliases: resolveAliasEntries(folder, manifest),
  };
}

export class ModuleManifest {
  public version: string;
  public readonly folder: string;
  public readonly source: ModuleSource;
  public readonly name: string;

  public main: string;
  public baseUrl: string;
  public paths: PathMapping[] = [];

  public manifest: ModulePackageJson;

  public implements: string[] = [];

  public srcAliases?: ModuleAliasEntry[];

  private constructor(
    folder: string,
    source: ModuleSource,
    name: string,
    manifest: ModulePackageJson,
    private fs: IFileSystem,
    state?: ModuleManifestState,
  ) {
    this.folder = path.resolve(folder);
    this.source = source;
    this.name = name;
    this.manifest = manifest;
    this.version = this.manifest.version;

    const manifestState =
      state ?? createManifestState(this.folder, source, this.manifest);
    this.main = manifestState.main;
    this.baseUrl = manifestState.baseUrl;
    this.paths = clonePathEntries(manifestState.paths);
    this.implements = [...manifestState.implements];
    this.srcAliases = cloneAliasEntries(manifestState.srcAliases);
  }

  static async create(
    folder: string,
    source: ModuleSource,
    name: string,
    fs: IFileSystem = new NodeFileSystem(),
  ): Promise<ModuleManifest> {
    const manifest = await ModuleManifest.readManifest(folder, fs);
    return new ModuleManifest(folder, source, name, manifest, fs);
  }

  static fromBuildEntry(
    entry: BuildModuleEntry,
    fs: IFileSystem = new NodeFileSystem(),
  ): ModuleManifest {
    const state: ModuleManifestState = {
      main: entry.main,
      baseUrl: entry.baseUrl,
      paths: clonePathEntries(entry.paths),
      implements: [...(entry.implements ?? [])],
      srcAliases: cloneAliasEntries(entry.srcAliases),
    };

    const manifest = new ModuleManifest(
      entry.folder,
      entry.source,
      entry.name,
      entry.manifest,
      fs,
      state,
    );
    manifest.version = entry.version;
    return manifest;
  }

  static async readManifest(
    folder: string,
    fs: IFileSystem = new NodeFileSystem(),
  ): Promise<ModulePackageJson> {
    const packageJsonPath = path.join(folder, "package.json");
    const dedicatedJsonPath = path.join(folder, "antelope.module.json");

    if (!(await fs.exists(packageJsonPath))) {
      throw new Error(`Missing package.json in '${folder}'`);
    }

    const packageJson = JSON.parse(
      await fs.readFileString(packageJsonPath),
    ) as ModulePackageJson;

    if (await fs.exists(dedicatedJsonPath)) {
      const dedicatedJson = JSON.parse(
        await fs.readFileString(dedicatedJsonPath),
      ) as ModulePackageJson["antelopeJs"];
      return {
        ...packageJson,
        antelopeJs: dedicatedJson,
      };
    }

    return packageJson;
  }

  serialize(): BuildModuleEntry {
    return {
      folder: this.folder,
      source: this.source,
      name: this.name,
      version: this.version,
      main: this.main,
      manifest: this.manifest,
      implements: [...this.implements],
      baseUrl: this.baseUrl,
      paths: clonePathEntries(this.paths),
      srcAliases: cloneAliasEntries(this.srcAliases),
    };
  }

  async reload(): Promise<void> {
    this.manifest = await ModuleManifest.readManifest(this.folder, this.fs);
    this.version = this.manifest.version;

    const state = createManifestState(this.folder, this.source, this.manifest);
    this.main = state.main;
    this.baseUrl = state.baseUrl;
    this.paths = clonePathEntries(state.paths);
    this.implements = [...state.implements];
    this.srcAliases = cloneAliasEntries(state.srcAliases);
  }
}
