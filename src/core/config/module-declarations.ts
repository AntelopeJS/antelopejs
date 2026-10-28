import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { readFile, writeFile } from "node:fs/promises";
import { NodeFileSystem } from "../filesystem";
import { removeModuleEntry, setModuleEntry } from "./config-editor";
import { loadTsConfigFile } from "./config-loader";
import { findConfigPath } from "./config-paths";
import { recordOwnConfigWrite } from "./config-writes";
import type {
  ModuleDeclaration,
  ModuleDeclarationChanges,
  ModuleEntryConfig,
} from "./module-entry";
import { isString } from "../../utils";

const FILE_ENCODING = "utf-8";
const PACKAGE_SOURCE = "package";

type SourceEdit = (source: string, fileName: string) => string;

let pendingWrite: Promise<void> = Promise.resolve();

function toDeclaration(
  key: string,
  entry: string | ModuleEntryConfig,
): ModuleDeclaration {
  if (isString(entry)) {
    const source: ModuleSourcePackage = {
      type: PACKAGE_SOURCE,
      package: key,
      version: entry,
    };
    return { source };
  }
  const versionSource: ModuleSourcePackage | undefined = entry.version
    ? { type: PACKAGE_SOURCE, package: key, version: entry.version }
    : undefined;
  return {
    source: entry.source ?? versionSource,
    config: entry.config,
    disabled: entry.disabled,
    optional: entry.optional,
  };
}

/**
 * The modules the project's configuration file declares at its top level,
 * disabled ones included, as the default environment evaluates them.
 */
export async function listModuleDeclarations(
  projectFolder: string,
): Promise<Record<string, ModuleDeclaration>> {
  const configPath = await findConfigPath(projectFolder, new NodeFileSystem());
  const config = await loadTsConfigFile(configPath, undefined, true);
  return Object.fromEntries(
    Object.entries(config.modules ?? {}).map(([key, entry]) => [
      key,
      toDeclaration(key, entry),
    ]),
  );
}

/**
 * Applies `edit` to the configuration file, one write at a time, and records
 * the result as the runtime's own so the watcher does not restart for it.
 */
function editConfigFile(
  projectFolder: string,
  edit: SourceEdit,
): Promise<void> {
  const run = pendingWrite.then(async () => {
    const configPath = await findConfigPath(
      projectFolder,
      new NodeFileSystem(),
    );
    const source = await readFile(configPath, FILE_ENCODING);
    const edited = edit(source, configPath);
    if (edited === source) return;
    recordOwnConfigWrite(configPath, edited);
    await writeFile(configPath, edited, FILE_ENCODING);
  });
  pendingWrite = run.catch(() => undefined);
  return run;
}

async function loadTypeScript(): Promise<typeof import("typescript")> {
  return import("typescript");
}

export async function saveModuleDeclaration(
  projectFolder: string,
  key: string,
  changes: ModuleDeclarationChanges,
): Promise<void> {
  const ts = await loadTypeScript();
  await editConfigFile(projectFolder, (source, fileName) =>
    setModuleEntry(ts, fileName, source, key, { ...changes }),
  );
}

export async function removeModuleDeclaration(
  projectFolder: string,
  key: string,
): Promise<void> {
  const ts = await loadTypeScript();
  await editConfigFile(projectFolder, (source, fileName) =>
    removeModuleEntry(ts, fileName, source, key),
  );
}
