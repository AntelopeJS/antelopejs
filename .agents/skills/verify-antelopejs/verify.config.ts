type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

interface DoorRule {
  globs: string[];
  funnels: string[];
  why: string;
}

interface VerifyConfig {
  doors: Record<DoorKind, DoorRule | null>;
}

const config: VerifyConfig = {
  doors: {
    data: {
      globs: [
        "src/cli/common.ts",
        "src/core/config/config-editor.ts",
        "src/core/config/config-writes.ts",
        "src/cli/commands/config/reset*.ts",
        "src/cli/commands/project/modules/remove*.ts",
        "src/cli/commands/project/logging/set*.ts",
      ],
      funnels: ["src/cli/common.ts", "src/core/config/config-writes.ts"],
      why: "these write antelope.config.ts or ~/.antelopejs/config.json, files the user authored",
    },
    format: {
      globs: [
        "src/core/modules/build-artifact.ts",
        "src/core/runtime/build-runtime.ts",
        "src/core/config/config-paths.ts",
        "src/cli/common.ts",
        "src/cli/version-check.ts",
      ],
      funnels: [],
      why: "build.json, the antelope.config.ts layout and ~/.antelopejs files must stay readable by the next version",
    },
    contract: {
      globs: [
        "src/index.ts",
        "src/core/cli/public.ts",
        "src/types/**",
        "src/cli/options.ts",
        "src/cli/commands/**/!(*-action|*-operations|*-usage|*-draft).ts",
        "package.json",
      ],
      funnels: [],
      why: "the published exports, the ajs command and flag tree, and the config keys consumers rely on",
    },
    outbound: {
      globs: ["src/cli/version-check.ts", "src/cli/commands/update.ts", "src/cli/global-package-manager.ts", "src/cli/plugin.ts"],
      funnels: ["src/cli/version-check.ts", "src/cli/global-package-manager.ts"],
      why: "these contact the npm registry or install packages globally on the user's machine",
    },
    exposure: {
      globs: ["src/logging/**", "src/core/output/failures.ts", "src/core/config/config-vars.ts", "src/core/config/config-var-*.ts", "src/cli/commands/config/show*.ts"],
      funnels: [],
      why: "these print configuration values, environment-provided secrets and error details",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      why: "the package name, its files and the release workflow claim names in the npm registry",
    },
  },
};

export default config;
