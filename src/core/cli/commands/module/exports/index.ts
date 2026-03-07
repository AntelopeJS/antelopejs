import { Command } from "commander";
import cmdGenerate from "./generate";
import cmdSet from "./set";

export default function () {
  return new Command("exports")
    .description(
      `Manage module exports\n` +
        `Configure which interfaces your module provides to other modules.`,
    )
    .addCommand(cmdSet())
    .addCommand(cmdGenerate());
}
