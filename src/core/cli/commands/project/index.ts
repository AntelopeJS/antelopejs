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
