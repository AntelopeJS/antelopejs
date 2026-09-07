import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

const preset = antelopeKnipConfig({
  // The unit suites live in `test/` at the repository root rather than under
  // `src/`, so the preset's `src/test/**` glob misses them and every helper
  // they exercise reads as dead code.
  entry: ["test/**/*.test.ts"],
  project: ["test/**/*.ts"],
  ignore: [
    // Resolved by path at run time, never imported: `prepare-embedded.ts`
    // does `path.join(__dirname, "host-module")` and `test-module.ts` does
    // `path.resolve(__dirname, "stub-interface")`. Both ship in `dist` and
    // the runtime loads them from there, so nothing in the import graph
    // points at them.
    "src/core/embedded/host-module.ts",
    "src/core/test/stub-interface.ts",
  ],
});

// `src/index.ts` exports `launch` both by name and as the package default.
// Both are published API on a 1.x package, so neither can be dropped here, and
// Knip has no per-export suppression for this check.
export default Object.assign(preset, {
  rules: { duplicates: "off" as const },
});
