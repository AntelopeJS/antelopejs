import { Command, Option } from "commander";

import { withExamples } from "../../../core/output";
import { lazyAction } from "../../lazy-action";
import { Options } from "../../options";

export default function () {
  const command = new Command("build")
    .summary("Build the project for production")
    .description(
      "Download and install the modules of the project, check that every module loads, and write the build artifact .antelope/build/build.json that ajs project start launches. npm modules install their dependencies from the lockfiles recorded in antelope-lock/, and a module without one records it.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(
      new Option(
        "--frozen-modules",
        "Install every npm module from its lock in antelope-lock/ and fail when one has none, instead of recording it",
      ).env("ANTELOPEJS_FROZEN_MODULES"),
    )
    .action(lazyAction(async () => (await import("./build-action")).runBuild));
  return withExamples(command, [
    {
      description: "Build the production environment",
      command: "ajs project build -e production",
    },
    {
      description: "Build in CI from the committed module locks only",
      command: "ajs project build --frozen-modules",
    },
  ]);
}
