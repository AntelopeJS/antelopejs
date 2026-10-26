import { Command } from "commander";

import cmdBuild from "./build";
import cmdDev from "./dev";
import cmdInit from "./init";
import cmdLogging from "./logging/index";
import cmdModule from "./modules/index";
import cmdRun from "./run";
import cmdStart from "./start";

export default function () {
  return new Command("project")
    .summary("Create, run, build and configure projects")
    .description(
      "Create, run and build AntelopeJS projects, and manage their modules and logging settings.",
    )
    .addCommand(cmdInit())
    .addCommand(cmdModule())
    .addCommand(cmdLogging())
    .addCommand(cmdDev())
    .addCommand(cmdBuild())
    .addCommand(cmdStart())
    .addCommand(cmdRun());
}
