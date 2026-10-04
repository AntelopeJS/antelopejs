import { CliError } from "../../output";
import { USAGE_EXIT_CODE } from "../../exit-codes";
import { isGitRepositoryUrl } from "../../git-url";

interface ConfigValueRule {
  name: string;
  isValid(value: string): boolean;
  expected: string;
  example: string;
}

const CONFIG_VALUE_RULES: Record<string, ConfigValueRule> = {
  git: {
    name: "git repository URL",
    isValid: isGitRepositoryUrl,
    expected:
      "an https or ssh URL, an scp-like address (git@host:org/repo.git) or an absolute path",
    example: "https://github.com/acme/interfaces.git",
  },
};

export const CONFIG_KEYS = Object.keys(CONFIG_VALUE_RULES);

export function invalidConfigKeyError(key: string): CliError {
  return new CliError({
    title: `Invalid configuration key '${key}'`,
    reason: `Valid keys: ${CONFIG_KEYS.join(", ")}`,
  });
}

/**
 * The usage error of a value the setting cannot hold, `undefined` when the
 * value is valid.
 */
export function invalidConfigValueError(
  key: string,
  value: string,
): CliError | undefined {
  const rule = CONFIG_VALUE_RULES[key];
  if (!rule || rule.isValid(value)) {
    return undefined;
  }
  return new CliError({
    title: `Invalid ${rule.name} '${value}'`,
    reason: `Expected ${rule.expected}.`,
    fixes: [`Pass a valid value, e.g. ajs config set ${key} ${rule.example}`],
    exitCode: USAGE_EXIT_CODE,
  });
}
