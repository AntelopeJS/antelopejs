import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "verify-http-fixture-test",
  modules: {
    "verify-http-fixture": {
      source: { type: "local", path: ".", installCommand: ["npx tsc"] },
    },
  },
  test: { folder: "test" },
});
