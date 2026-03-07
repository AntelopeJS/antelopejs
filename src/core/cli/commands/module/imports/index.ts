import { Command } from "commander";

import cmdAdd from "./add";
import cmdInstall from "./install";
import cmdList from "./list";
import cmdRemove from "./remove";
import cmdUpdate from "./update";

export default function () {
  return new Command("imports")
    .description(
      `Manage module imports\n` +
        `Add, remove, or update interfaces that your module uses from other modules.`,
    )
    .addCommand(cmdList())
    .addCommand(cmdAdd())
    .addCommand(cmdRemove())
    .addCommand(cmdUpdate())
    .addCommand(cmdInstall());
}
