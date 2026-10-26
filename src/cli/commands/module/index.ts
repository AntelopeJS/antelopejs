import { Command } from "commander";

import cmdInit from "./init";
import cmdTest from "./test";

export default function () {
  return new Command("module")
    .summary("Create and test modules")
    .description(
      "Create a module from a template of the interface repository, and run the tests of a module.",
    )
    .addCommand(cmdInit())
    .addCommand(cmdTest());
}
