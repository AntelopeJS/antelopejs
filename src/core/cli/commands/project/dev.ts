import { Command, Option } from "commander";

import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

const ENV_OPTION = new Option(
  "-e, --env <environment>",
  "Environment to use (development, production, etc.)",
).env("ANTELOPEJS_LAUNCH_ENV");
const WATCH_OPTION = new Option(
  "-w, --watch",
  "Watch for changes and automatically restart",
);
const CONCURRENCY_OPTION = new Option(
  "-c, --concurrency <number>",
  "Number of modules to load concurrently",
).argParser(parseInt);
const INSPECT_OPTION = new Option(
  "--inspect [host:port]",
  "Enable inspector on host:port (default: 127.0.0.1:9229)",
);
const INTERACTIVE_OPTION = new Option(
  "-i, --interactive",
  "Run a REPL with the project",
);

interface DevCommandDefinition {
  name: string;
  description: string;
}

const DEV_COMMAND_DEFINITION: DevCommandDefinition = {
  name: "dev",
  description:
    `Run your AntelopeJS project in development mode\n` +
    `Starts your application by loading and connecting all modules defined in your project.`,
};

function withDevCommandOptions(command: Command): Command {
  return command
    .addOption(Options.project)
    .addOption(Options.verbose)
    .addOption(ENV_OPTION)
    .addOption(WATCH_OPTION)
    .addOption(CONCURRENCY_OPTION)
    .addOption(INSPECT_OPTION)
    .addOption(INTERACTIVE_OPTION);
}

export function createDevCommand(
  definition: DevCommandDefinition = DEV_COMMAND_DEFINITION,
): Command {
  const command = new Command(definition.name).description(
    definition.description,
  );
  return withDevCommandOptions(command).action(
    lazyAction(async () => (await import("./dev-action")).executeDevCommand),
  );
}

export default function () {
  return createDevCommand();
}
