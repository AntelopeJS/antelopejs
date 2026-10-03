import { Command, Option } from "commander";

import { Options } from "../../options";
import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

const WATCH_OPTION = new Option(
  "-w, --watch",
  "Reload modules when their source files change",
);
const CONCURRENCY_OPTION = new Option(
  "-c, --concurrency <number>",
  "Number of modules to load concurrently",
).argParser(parseInt);
const INSPECT_OPTION = new Option(
  "--inspect [host:port]",
  "Enable the Node.js inspector (default: 127.0.0.1:9229)",
);
const INTERACTIVE_OPTION = new Option(
  "-i, --interactive",
  "Open a REPL with the project loaded",
);

interface DevCommandDefinition {
  name: string;
  summary: string;
  description: string;
}

const DEV_COMMAND_DEFINITION: DevCommandDefinition = {
  name: "dev",
  summary: "Run the project in development mode",
  description:
    "Run the project in development mode: download and install its modules, then load and connect them. Add --watch to reload modules when their files change.",
};

const DEV_EXAMPLES = [
  {
    description: "Run the project and reload it on changes",
    command: "ajs project dev --watch",
  },
  {
    description: "Run another project with its staging environment",
    command: "ajs project dev -p ./my-app -e staging",
  },
  {
    description: "Enable the Node.js inspector",
    command: "ajs project dev --inspect 0.0.0.0:9229",
  },
];

function withDevCommandOptions(command: Command): Command {
  return command
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(WATCH_OPTION)
    .addOption(CONCURRENCY_OPTION)
    .addOption(INSPECT_OPTION)
    .addOption(INTERACTIVE_OPTION);
}

export function createDevCommand(
  definition: DevCommandDefinition = DEV_COMMAND_DEFINITION,
): Command {
  const command = new Command(definition.name)
    .summary(definition.summary)
    .description(definition.description);
  return withExamples(withDevCommandOptions(command), DEV_EXAMPLES).action(
    lazyAction(async () => (await import("./dev-action")).executeDevCommand),
  );
}

export default function () {
  return createDevCommand();
}
