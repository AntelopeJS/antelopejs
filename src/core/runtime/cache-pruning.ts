import { Logging } from "@antelopejs/interface-core/logging";
import { createHash, randomUUID } from "node:crypto";
import * as path from "node:path";

import type { IFileSystem } from "../../types";
import { isObject, isString } from "../../utils";
import {
  type CacheKeep,
  entryCovers,
  getBuildArtifactPath,
  type ModuleCache,
  readBuildArtifactFile,
} from "../modules";

const Logger = new Logging.Channel("loader");

const PINS_FOLDER = ".builds";
const PIN_EXTENSION = ".json";
const PIN_NAME_LENGTH = 16;

/**
 * What `<cache>/.builds/<hash>.json` holds: the absolute path of a
 * `build.json` whose module folders a prune of the cache keeps.
 */
interface BuildPin {
  buildFile: string;
}

function isBuildPin(value: unknown): value is BuildPin {
  return isObject(value) && isString(value.buildFile);
}

function pinPath(cachePath: string, buildFile: string): string {
  const name = createHash("sha256")
    .update(buildFile)
    .digest("hex")
    .slice(0, PIN_NAME_LENGTH);
  return path.join(cachePath, PINS_FOLDER, `${name}${PIN_EXTENSION}`);
}

/**
 * Pins the build whose `build.json` is at `buildFile` in the cache at
 * `cachePath`, so that a prune keeps the module folders it points at for as
 * long as the file exists.
 */
export async function writeBuildPin(
  cachePath: string,
  buildFile: string,
  fs: IFileSystem,
): Promise<void> {
  const pin: BuildPin = { buildFile: path.resolve(buildFile) };
  const file = pinPath(cachePath, pin.buildFile);
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(pin));
  await fs.rename(temp, file);
}

/**
 * The build files the pins of the cache at `cachePath` name. A pin whose
 * build file no longer exists is deleted.
 *
 * @throws when a pin cannot be parsed.
 */
async function readPinnedBuildFiles(
  cachePath: string,
  fs: IFileSystem,
): Promise<string[]> {
  const folder = path.join(cachePath, PINS_FOLDER);
  if (!(await fs.exists(folder))) {
    return [];
  }
  const names = await fs.readdir(folder);
  const buildFiles: string[] = [];
  for (const name of names.filter((item) => item.endsWith(PIN_EXTENSION))) {
    const pinFile = path.join(folder, name);
    const pin: unknown = JSON.parse(await fs.readFileString(pinFile));
    if (!isBuildPin(pin)) {
      throw new Error(`The build pin ${pinFile} does not name a build file`);
    }
    if (await fs.exists(pin.buildFile)) {
      buildFiles.push(pin.buildFile);
    } else {
      await fs.rm(pinFile, { force: true });
    }
  }
  return buildFiles;
}

async function readBuiltFolders(
  buildFile: string,
  fs: IFileSystem,
): Promise<string[]> {
  if (!(await fs.exists(buildFile))) {
    return [];
  }
  const artifact = await readBuildArtifactFile(buildFile, fs);
  return Object.values(artifact.modules).map(({ folder }) => folder);
}

/**
 * Keeps every entry whose folder holds a module folder of the project's own
 * `build.json` or of a pinned build.
 *
 * @throws when a pin or an existing `build.json` cannot be read.
 */
async function readBuildKeep(
  cache: ModuleCache,
  projectFolder: string,
  fs: IFileSystem,
): Promise<CacheKeep> {
  const buildFiles = new Set([
    getBuildArtifactPath(projectFolder),
    ...(await readPinnedBuildFiles(cache.path, fs)),
  ]);
  const folders = await Promise.all(
    [...buildFiles].map((buildFile) => readBuiltFolders(buildFile, fs)),
  );
  const kept = folders
    .flat()
    .map((folder) => cache.entryOf(folder))
    .filter(isString);
  return (entry) => kept.some((folder) => entryCovers(folder, entry));
}

/**
 * Removes the cached modules that no live run uses and no build points at:
 * the lease of each live run keeps what it loaded, and the project's
 * `.antelope/build/build.json` and every pinned build keep their module
 * folders. A failure is logged, never thrown, since the modules have already
 * loaded.
 */
export async function pruneModuleCache(
  cache: ModuleCache,
  projectFolder: string,
  fs: IFileSystem,
): Promise<void> {
  try {
    await cache.prune(() => readBuildKeep(cache, projectFolder, fs));
  } catch (error) {
    Logger.Warn("Could not remove unused modules from the cache:", error);
  }
}
