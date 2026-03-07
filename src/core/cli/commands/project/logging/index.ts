import { Command } from "commander";
import cmdSet from "./set";
import cmdShow from "./show";

export default function () {
  return new Command("logging")
    .description(
      `Configure and view project logging\n` +
        `Manage logging configuration and view log output`,
    )
    .addCommand(cmdShow())
    .addCommand(cmdSet());
}
