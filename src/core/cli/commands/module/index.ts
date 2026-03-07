import { Command } from "commander";
import cmdExports from "./exports";
import cmdImports from "./imports";
import cmdInit from "./init";
import cmdTest from "./test";

export default function () {
  return new Command("module")
    .description(
      `Manage AntelopeJS Modules\n` +
        `Create modules and manage their interfaces, imports, and exports.`,
    )
    .addCommand(cmdInit())
    .addCommand(cmdTest())
    .addCommand(cmdImports())
    .addCommand(cmdExports());
}
