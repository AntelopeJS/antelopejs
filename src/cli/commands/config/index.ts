import { Command } from "commander";

import cmdGet from "./get";
import cmdSet from "./set";
import cmdShow from "./show";
import cmdReset from "./reset";

export default function () {
  return new Command("config")
    .summary("Show or change CLI settings")
    .description(
      "Show or change the settings of the CLI, stored in ~/.antelopejs/config.json and shared by every project.",
    )
    .addCommand(cmdShow())
    .addCommand(cmdGet())
    .addCommand(cmdSet())
    .addCommand(cmdReset());
}
