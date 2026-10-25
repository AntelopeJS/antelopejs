import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

const preset = antelopeKnipConfig({
  entry: ["test/**/*.test.ts"],
  project: ["test/**/*.ts"],
  ignore: [
    "src/core/embedded/host-module.ts",
    "src/core/test/stub-interface.ts",
  ],
});

export default Object.assign(preset, {
  rules: { duplicates: "off" as const },
});
