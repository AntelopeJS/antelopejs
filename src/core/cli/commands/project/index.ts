import { Command } from "commander";

import cmdDev from "./dev";
import cmdRun from "./run";
import cmdInit from "./init";
import cmdBuild from "./build";
import cmdStart from "./start";
import cmdModule from "./modules";
import cmdLogging from "./logging";

export default function () {
  return new Command("project")
    .description(
      `Manage AntelopeJS Projects\n` +
        `Create, configure, and run projects that bring together different modules.`,
    )
    .addCommand(cmdInit())
    .addCommand(cmdModule())
    .addCommand(cmdLogging())
    .addCommand(cmdDev())
    .addCommand(cmdBuild())
    .addCommand(cmdStart())
    .addCommand(cmdRun());
}
