import type {
  ModuleSourceGit,
  ModuleSourceLocal,
  ModuleSourceLocalFolder,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";

import { ConfigLoader } from "../../../../config";
import { NodeFileSystem } from "../../../../filesystem";
import {
  getProcessUi,
  pluralize,
  writeData,
  type TableColumn,
  type Ui,
} from "../../../output";
import { resolveProjectContext } from "../../shared/project-command";

interface ListOptions {
  project: string;
  env?: string;
  json?: boolean;
}

interface ModuleEntry {
  source?: unknown;
}

interface ModuleListing {
  name: string;
  source: unknown;
}

interface SourceSummary {
  kind: string;
  reference: string;
}

interface ModuleRow extends SourceSummary {
  name: string;
}

type KnownModuleSource =
  | ModuleSourcePackage
  | ModuleSourceGit
  | ModuleSourceLocal
  | ModuleSourceLocalFolder;
type SourceSummarizer = (
  source: KnownModuleSource,
  moduleName: string,
) => SourceSummary;

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

const SOURCE_SUMMARIZERS: Record<string, SourceSummarizer> = {
  package: (source, moduleName) => ({
    kind: "npm",
    reference: packageReference(source as ModuleSourcePackage, moduleName),
  }),
  git: (source) => ({
    kind: "git",
    reference: gitReference(source as ModuleSourceGit),
  }),
  local: (source) => ({
    kind: "local",
    reference: (source as ModuleSourceLocal).path,
  }),
  "local-folder": (source) => ({
    kind: "folder",
    reference: (source as ModuleSourceLocalFolder).path,
  }),
};

function summarizeSource(listing: ModuleListing): SourceSummary {
  const sourceType = (listing.source as KnownModuleSource | undefined)?.type;
  const summarize = sourceType ? SOURCE_SUMMARIZERS[sourceType] : undefined;
  if (!summarize) {
    return {
      kind: UNKNOWN_SOURCE_KIND,
      reference: JSON.stringify(listing.source) ?? MISSING_REFERENCE,
    };
  }
  return summarize(listing.source as KnownModuleSource, listing.name);
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
  const modules = Object.entries(
    antelopeConfig.modules as Record<string, ModuleEntry>,
  ).map(([name, entry]) => ({ name, source: entry.source }));
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
