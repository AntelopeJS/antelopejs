import { Command } from "commander";

import cmdAdd from "./add";
import cmdList from "./list";
import cmdRemove from "./remove";
import cmdUpdate from "./update";
import cmdInstall from "./install";

export default function () {
  return new Command("modules")
    .summary("Add, remove, list and update modules")
    .description(
      "Add, remove, list and update the modules of the project, and add the modules that implement its unresolved interfaces.",
    )
    .addCommand(cmdAdd())
    .addCommand(cmdRemove())
    .addCommand(cmdUpdate())
    .addCommand(cmdInstall())
    .addCommand(cmdList());
}
