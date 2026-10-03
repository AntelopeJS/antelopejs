import { Command, Option } from "commander";

import { Options } from "../../../options";
import { withExamples } from "../../../help";
import { lazyAction } from "../../../lazy-action";

export const MODULE_SOURCE_MODES = ["package", "git", "local", "dir"];

export default function () {
  const command = new Command("add")
    .summary("Add modules to the project")
    .description(
      "Add modules to the project configuration and download them. --mode sets where they come from: package (an npm package, optionally with a version, range or dist-tag), git (a repository URL), local (the folder of one module) or dir (a folder whose every subfolder is a module).",
    )
    .argument(
      "<modules...>",
      "npm packages, repository URLs or paths, depending on --mode",
    )
    .addOption(
      new Option("-m, --mode <mode>", "Source of the modules")
        .choices(MODULE_SOURCE_MODES)
        .default("package"),
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .action(
      lazyAction(
        async () => (await import("./add-action")).projectModulesAddCommand,
      ),
    );
  return withExamples(command, [
    {
      description: "Add the latest version of an npm package",
      command: "ajs project modules add @antelopejs/api",
    },
    {
      description: "Pin an exact version",
      command: "ajs project modules add @antelopejs/api@1.3.2",
    },
    {
      description: "Add a module from a local folder",
      command: "ajs project modules add ./modules/auth --mode local",
    },
  ]);
}
