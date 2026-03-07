import { Command } from "commander";

import cmdAdd from "./add";
import cmdInstall from "./install";
import cmdList from "./list";
import cmdRemove from "./remove";
import cmdUpdate from "./update";

export default function () {
  return new Command("modules")
    .description(
      `Manage modules in your AntelopeJS project\n` +
        `Add, remove, update and fix modules in your project.`,
    )
    .addCommand(cmdAdd())
    .addCommand(cmdRemove())
    .addCommand(cmdUpdate())
    .addCommand(cmdInstall())
    .addCommand(cmdList());
}
