import type {
  ModuleSource,
  ModuleSourceGit,
  ModuleSourceLocal,
  ModuleSourceLocalFolder,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";

import { ConfigLoader } from "../../../../core/config";
import { NodeFileSystem } from "../../../../core/filesystem";
import {
  getProcessUi,
  pluralize,
  writeData,
  type TableColumn,
  type Ui,
} from "../../../../core/output";
import { isObject, isString } from "../../../../utils";
import { resolveProjectContext } from "../../shared/project-command";

interface ListOptions {
  project: string;
  env?: string;
  json?: boolean;
}

interface ModuleListing {
  name: string;
  source: ModuleSource;
}

interface SourceSummary {
  kind: string;
  reference: string;
}

interface ModuleRow extends SourceSummary {
  name: string;
}

const UNKNOWN_SOURCE_KIND = "unknown";
const MISSING_REFERENCE = "-";
const SHORT_COMMIT_LENGTH = 8;
const ADD_MODULE_COMMAND = "ajs project modules add <name>";

function packageReference(
  source: ModuleSourcePackage,
  moduleName: string,
): string {
  return source.package === moduleName
    ? source.version
    : `${source.package}@${source.version}`;
}

function gitReference(source: ModuleSourceGit): string {
  const branch = source.branch ? `branch ${source.branch}` : "";
  const commit = source.commit
    ? `commit ${source.commit.substring(0, SHORT_COMMIT_LENGTH)}`
    : "";
  return [source.remote, branch, commit].filter(Boolean).join(" ");
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isPackageSource(source: ModuleSource): source is ModuleSourcePackage {
  return (
    isObject(source) &&
    source.type === "package" &&
    isString(source.package) &&
    isString(source.version)
  );
}

function isGitSource(source: ModuleSource): source is ModuleSourceGit {
  return (
    isObject(source) &&
    source.type === "git" &&
    isString(source.remote) &&
    isOptionalString(source.branch) &&
    isOptionalString(source.commit)
  );
}

function isLocalSource(source: ModuleSource): source is ModuleSourceLocal {
  return isObject(source) && source.type === "local" && isString(source.path);
}

function isFolderSource(
  source: ModuleSource,
): source is ModuleSourceLocalFolder {
  return (
    isObject(source) && source.type === "local-folder" && isString(source.path)
  );
}

function summarizeSource(listing: ModuleListing): SourceSummary {
  const { source, name } = listing;
  if (isPackageSource(source)) {
    return { kind: "npm", reference: packageReference(source, name) };
  }
  if (isGitSource(source)) {
    return { kind: "git", reference: gitReference(source) };
  }
  if (isLocalSource(source)) {
    return { kind: "local", reference: source.path };
  }
  if (isFolderSource(source)) {
    return { kind: "folder", reference: source.path };
  }
  return {
    kind: UNKNOWN_SOURCE_KIND,
    reference: JSON.stringify(source) ?? MISSING_REFERENCE,
  };
}

const MODULE_COLUMNS: TableColumn<ModuleRow>[] = [
  { header: "Name", value: (row) => row.name },
  { header: "Source", value: (row) => row.kind },
  { header: "Reference", value: (row) => row.reference },
];

function renderModuleList(
  modules: ModuleListing[],
  location: string,
  ui: Ui,
): void {
  if (modules.length === 0) {
    ui.message("info", `No modules in ${location}`);
    ui.message("hint", `Add one with ${ADD_MODULE_COMMAND}`);
    return;
  }
  const rows = modules.map((listing) => ({
    name: listing.name,
    ...summarizeSource(listing),
  }));
  ui.message("info", `${pluralize(rows.length, "module")} in ${location}`);
  ui.table(rows, MODULE_COLUMNS);
}

async function listModules(options: ListOptions, ui: Ui): Promise<void> {
  const { config, environment } = await resolveProjectContext(
    options.project,
    options.env,
  );
  const loader = new ConfigLoader(new NodeFileSystem());
  const antelopeConfig = await loader.load(options.project, environment);
  const modules = Object.entries(antelopeConfig.modules).map(
    ([name, entry]) => ({
      name,
      source: entry.source,
    }),
  );
  writeData(ui, {
    data: modules,
    isJson: options.json,
    render: (target) =>
      renderModuleList(modules, `${config.name} (${environment})`, target),
  });
}

export function listModulesAction(ui: Ui = getProcessUi()) {
  return (options: ListOptions) => listModules(options, ui);
}
