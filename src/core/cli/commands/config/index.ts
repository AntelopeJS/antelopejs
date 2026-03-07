import { Command } from "commander";
import cmdGet from "./get";
import cmdReset from "./reset";
import cmdSet from "./set";
import cmdShow from "./show";

export default function () {
  return new Command("config")
    .description(
      `Manage CLI Configuration\n` +
        `View and change settings for the AntelopeJS CLI.`,
    )
    .addCommand(cmdShow())
    .addCommand(cmdGet())
    .addCommand(cmdSet())
    .addCommand(cmdReset());
}
