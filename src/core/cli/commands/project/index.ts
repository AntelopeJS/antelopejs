import { Command } from "commander";
import cmdBuild from "./build";
import cmdDev from "./dev";
import cmdInit from "./init";
import cmdLogging from "./logging";
import cmdModule from "./modules";
import cmdRun from "./run";
import cmdStart from "./start";

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
