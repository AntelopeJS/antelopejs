import { Command, Option } from "commander";

import { Options } from "../../../options";
import { lazyAction } from "../../../lazy-action";

export default function () {
  return new Command("install")
    .description(
      `Install module dependencies in your project\n` +
        `Identifies and resolves missing module dependencies. An interface implemented by a single module gets that module without a question.`,
    )
    .addOption(Options.project)
    .addOption(Options.git)
    .addOption(
      new Option("-e, --env <environment>", "Environment to analyze").env(
        "ANTELOPEJS_LAUNCH_ENV",
      ),
    )
    .addOption(
      new Option(
        "-y, --yes",
        "Add the first module listed when several implement an interface",
      ),
    )
    .action(
      lazyAction(async () => (await import("./install-action")).installModules),
    );
}
