import path from "node:path";

import { displayPath } from "../../output";
import { DEFAULT_ENV } from "../../../config/config-paths";

export interface CommandScope {
  project: string;
  env?: string;
}

const PROJECT_FLAG = "--project";
const ENV_FLAG = "--env";
const WHITESPACE_PATTERN = /\s/;

function quoteArgument(argument: string): string {
  return WHITESPACE_PATTERN.test(argument) ? `"${argument}"` : argument;
}

/**
 * A command to suggest as a next step, with the `--project` and `--env`
 * flags the current run needed so it can be copied as is.
 */
export function scopedCommand(command: string, scope: CommandScope): string {
  const projectFolder = path.resolve(scope.project);
  const flags = [
    projectFolder === process.cwd()
      ? ""
      : `${PROJECT_FLAG} ${quoteArgument(displayPath(projectFolder))}`,
    scope.env && scope.env !== DEFAULT_ENV ? `${ENV_FLAG} ${scope.env}` : "",
  ];
  return [command, ...flags].filter((part) => part !== "").join(" ");
}
