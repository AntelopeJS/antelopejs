import path from "node:path";

import { NodeFileSystem } from "../../../../core/filesystem";
import {
  type LeaseState,
  type LeaseStatus,
  readLeaseStatuses,
} from "../../../../core/modules";
import {
  createPrompter,
  getProcessUi,
  pluralize,
  type TableColumn,
  type Ui,
} from "../../../../core/output";
import { resolveProjectContext } from "../../shared/project-command";
import { moduleCachePath } from "./module-locks";

interface ReleaseLeasesOptions {
  project: string;
  env?: string;
  foreign?: boolean;
  yes?: boolean;
}

const RELEASE_COMMAND = "ajs project modules release-leases";
const YES_FLAG = "--yes";
const UNKNOWN = "-";

/** What `release-leases` prints of each run state, and the reason it gives when it removes a lease of that state. */
const STATES: Record<LeaseState, { label: string; why: string }> = {
  live: { label: "running", why: "its run still runs" },
  exited: { label: "exited", why: "its run has exited" },
  foreign: {
    label: "foreign",
    why: "its run is on another host or in another pid namespace",
  },
};

const LEASE_COLUMNS: TableColumn<LeaseStatus>[] = [
  { header: "Lease", value: (status) => path.basename(status.file) },
  { header: "Run", value: (status) => STATES[status.state].label },
  { header: "Host", value: (status) => status.lease?.host ?? UNKNOWN },
  {
    header: "Namespace",
    value: (status) => status.lease?.namespace ?? UNKNOWN,
  },
  { header: "Pid", value: (status) => String(status.lease?.pid ?? UNKNOWN) },
  {
    header: "Entries",
    value: (status) =>
      status.lease === undefined
        ? "unreadable"
        : status.lease.entries.join(", ") || UNKNOWN,
  },
];

/**
 * Whether to delete `foreign`, the leases of runs this host cannot check:
 * only with `--foreign`, and after a confirmation that `--yes` gives
 * without a terminal.
 */
async function confirmForeign(
  foreign: LeaseStatus[],
  options: ReleaseLeasesOptions,
  ui: Ui,
): Promise<boolean> {
  if (foreign.length === 0) {
    return false;
  }
  if (!options.foreign) {
    ui.message(
      "hint",
      `Kept ${pluralize(foreign.length, "foreign lease")}. If those runs are gone, run ${RELEASE_COMMAND} --foreign`,
    );
    return false;
  }
  return createPrompter({ command: `${RELEASE_COMMAND} --foreign` }).confirm({
    message: `Delete ${pluralize(foreign.length, "lease")} of runs on other hosts or in other pid namespaces? Their runs may still use the cache.`,
    flag: YES_FLAG,
    answer: options.yes,
    defaultAnswer: false,
  });
}

async function releaseLeases(
  options: ReleaseLeasesOptions,
  ui: Ui,
): Promise<void> {
  const { config } = await resolveProjectContext(options.project, options.env);
  const cachePath = moduleCachePath(options.project, config);
  const fs = new NodeFileSystem();
  const statuses = await readLeaseStatuses(cachePath, fs);
  if (statuses.length === 0) {
    ui.message("info", `No leases in ${cachePath}`);
    return;
  }
  ui.message("info", `${pluralize(statuses.length, "lease")} in ${cachePath}`);
  ui.table(statuses, LEASE_COLUMNS);
  const foreign = statuses.filter((status) => status.state === "foreign");
  const released = [
    ...statuses.filter((status) => status.state === "exited"),
    ...((await confirmForeign(foreign, options, ui)) ? foreign : []),
  ];
  for (const status of released) {
    await fs.rm(status.file, { force: true });
    ui.message(
      "success",
      `Removed ${path.basename(status.file)}: ${STATES[status.state].why}`,
    );
  }
  ui.summary({
    headline:
      released.length === 0
        ? "No lease removed"
        : `Removed ${pluralize(released.length, "lease")}`,
  });
}

export function releaseLeasesAction(ui: Ui = getProcessUi()) {
  return (options: ReleaseLeasesOptions) => releaseLeases(options, ui);
}
