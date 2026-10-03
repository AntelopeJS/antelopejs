import chalk from "chalk";

import { CONFIG_KEYS } from "./keys";
import { displayBox, error, keyValue, success } from "../../cli-ui";
import {
  DEFAULT_GIT_REPO,
  displayNonDefaultGitWarning,
  readUserConfig,
  writeUserConfig,
} from "../../common";

export async function setConfigValue(
  key: string,
  value: string,
): Promise<void> {
  console.log(""); // Add spacing for better readability

  // Validate the configuration key
  if (!CONFIG_KEYS.includes(key)) {
    error(`Invalid configuration key: ${chalk.bold(key)}`);
    console.log(
      `Valid keys are: ${CONFIG_KEYS.map((k) => chalk.cyan(k)).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const config = await readUserConfig();

  // Display non-default git warning if applicable
  if (key === "git" && value !== DEFAULT_GIT_REPO) {
    displayNonDefaultGitWarning(value);
  }

  // Show what's being changed
  const oldValue = config[key as keyof typeof config];

  // Update the configuration
  config[key as keyof typeof config] = value as any;
  await writeUserConfig(config);

  // Display success message
  success(`Configuration updated successfully`);

  // Show the change in a nicely formatted box
  const formattedChange = `${keyValue(key, chalk.dim(`${oldValue} → `) + chalk.green(value))}`;
  await displayBox(formattedChange, "📝 Configuration Changed", {
    padding: 1,
    borderColor: "green",
  });
}
