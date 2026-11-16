import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "verify-workspace-fixture-test",
  modules: {
    "verify-workspace-fixture": {
      source: { type: "local", path: ".", installCommand: ["npx tsc"] },
    },
  },
  test: { folder: "test" },
});
