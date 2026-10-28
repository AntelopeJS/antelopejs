import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "greeter",
  modules: {
    "greeter-provider": {
      source: { type: "local", path: "./provider", installCommand: ["pnpm install --offline"] },
      config: { prefix: "Hello" },
    },
    "greeter-consumer": {
      source: { type: "local", path: "./consumer" },
    },
  },
});
