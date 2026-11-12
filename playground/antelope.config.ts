import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "playground",
  modules: {
    "module-a": {
      source: {
        type: "local",
        path: "./modules/module-a",
        installCommand: ["pnpm install --ignore-workspace", "npx tsc"],
      },
      config: { prefix: "Hello" },
    },
    "module-b": {
      source: {
        type: "local",
        path: "./modules/module-b",
        installCommand: ["pnpm install --ignore-workspace", "npx tsc"],
      },
      config: { target: "World" },
    },
  },
});
