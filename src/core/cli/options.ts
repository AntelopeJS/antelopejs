import path from "node:path";
import { Option } from "commander";

const ALL_LOG_CHANNELS = "*";

export namespace Options {
  export const project = new Option(
    "-p, --project <path>",
    "Path to AntelopeJS project",
  )
    .default(path.resolve(process.cwd()))
    .env("ANTELOPEJS_PROJECT")
    .argParser((val) => path.resolve(val));
  export const git = new Option("-g, --git <url>", "URL to git interfaces").env(
    "ANTELOPEJS_GIT",
  );
  export const verbose = new Option(
    "--verbose [=channels]",
    "Enable verbose logging (TRACE level) for specific log channels (comma-separated).",
  )
    .env("ANTELOPEJS_VERBOSE")
    .preset(ALL_LOG_CHANNELS)
    .argParser((val) => val.replaceAll(/%/g, "*").split(","));
  export const json = new Option(
    "-j, --json",
    "Print the result as JSON on stdout",
  );
}
