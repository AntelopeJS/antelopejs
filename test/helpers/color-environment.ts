const COLOR_VARIABLES = ["FORCE_COLOR", "NO_COLOR"];
const FORCED_COLORS = "1";
const DISABLED_COLORS = "0";

/**
 * Registers hooks that turn colors on or off for each test of the suite
 * through `FORCE_COLOR`, and restore the color variables afterwards.
 */
export function useColorLevel(hasColor: boolean): void {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = Object.fromEntries(
      COLOR_VARIABLES.map((name) => [name, process.env[name]]),
    );
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = hasColor ? FORCED_COLORS : DISABLED_COLORS;
  });

  afterEach(() => {
    Object.entries(saved).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
        return;
      }
      process.env[name] = value;
    });
  });
}

/** Turns colors on or off for the rest of the running test. */
export function setColorLevel(hasColor: boolean): void {
  process.env.FORCE_COLOR = hasColor ? FORCED_COLORS : DISABLED_COLORS;
}
