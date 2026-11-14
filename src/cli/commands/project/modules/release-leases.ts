import { Command, Option } from "commander";

import type { Ui } from "../../../../core/output";
import { withExamples } from "../../../../core/output";
import { lazyAction } from "../../../lazy-action";
import { Options } from "../../../options";

export default function (ui?: Ui) {
  const command = new Command("release-leases")
    .summary("Delete the cache leases of runs that are gone")
    .description(
      "List every lease in the module cache with the host, pid namespace and pid of its run and the folders it keeps, and delete the leases of runs of this host and pid namespace that have exited. A run on another host or in another pid namespace is foreign: the CLI cannot tell whether it still runs, so its lease is deleted only with --foreign, after a confirmation.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(
      new Option(
        "--foreign",
        "Also delete the leases of runs on other hosts or in other pid namespaces",
      ),
    )
    .addOption(
      new Option("-y, --yes", "Delete foreign leases without a confirmation"),
    )
    .action(
      lazyAction(async () =>
        (await import("./release-leases-action")).releaseLeasesAction(ui),
      ),
    );
  return withExamples(command, [
    {
      description: "Delete the leases of runs of this host that have exited",
      command: "ajs project modules release-leases",
    },
    {
      description:
        "Also delete the leases of a container run that was killed, without a prompt",
      command: "ajs project modules release-leases --foreign --yes",
    },
  ]);
}
