const HOME_VARIABLES = ["HOME", "USERPROFILE"] as const;

/**
 * Points `os.homedir()` at `home`, which reads `HOME` on POSIX and
 * `USERPROFILE` on Windows, and returns the function that restores both.
 */
export function redirectHome(home: string): () => void {
  const saved = HOME_VARIABLES.map((key) => [key, process.env[key]] as const);
  for (const key of HOME_VARIABLES) {
    process.env[key] = home;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
