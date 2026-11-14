const TRUTHY_ENV_VALUES = new Set(["1", "true"]);

/**
 * Whether the environment variable `name` turns a switch on: `1` or `true`,
 * trimmed and in any case.
 */
export function isEnvironmentFlagSet(name: string): boolean {
  const value = process.env[name];
  return (
    value !== undefined && TRUTHY_ENV_VALUES.has(value.trim().toLowerCase())
  );
}
