import { Command } from "commander";

import cmdSet from "./set";
import cmdShow from "./show";

export default function () {
  return new Command("logging")
    .summary("Show or change logging settings")
    .description(
      "Show or change the logging settings saved in antelope.config.ts, which the runtime applies when the project runs.",
    )
    .addCommand(cmdShow())
    .addCommand(cmdSet());
}
