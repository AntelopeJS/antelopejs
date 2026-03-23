import { Command } from "commander";
import cmdInit from "./init";
import cmdTest from "./test";

export default function () {
  return new Command("module")
    .description(
      `Manage AntelopeJS Modules\n` + `Create modules and run module tests.`,
    )
    .addCommand(cmdInit())
    .addCommand(cmdTest());
}
