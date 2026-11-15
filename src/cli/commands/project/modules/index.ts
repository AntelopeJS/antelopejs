import { Command } from "commander";

import cmdAdd from "./add";
import cmdInstall from "./install";
import cmdList from "./list";
import cmdReleaseLeases from "./release-leases";
import cmdRemove from "./remove";
import cmdUpdate from "./update";

export default function () {
  return new Command("modules")
    .summary("Add, remove, list and update modules")
    .description(
      "Add, remove, list and update the modules of the project, add the modules that implement its unresolved interfaces, and release the module cache leases of runs that are gone.",
    )
    .addCommand(cmdAdd())
    .addCommand(cmdRemove())
    .addCommand(cmdUpdate())
    .addCommand(cmdInstall())
    .addCommand(cmdList())
    .addCommand(cmdReleaseLeases());
}
