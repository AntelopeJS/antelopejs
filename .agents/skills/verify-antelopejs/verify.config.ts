/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind, and the journeys, as `feature/journey`, that contain it. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  containments: string[];
  why: string;
}

/** A formal check: the source files it covers, the command that runs it, and how its output names a violated rule. */
export interface FormalCheck {
  name: string;
  covers: string[];
  command: string[];
  violation: RegExp | null;
}

/** The repo-owned layer of the verification skill. */
export interface VerifyConfig {
  doors: Record<DoorKind, DoorRule | null>;
  formal: FormalCheck[];
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
      containments: ["project-modules/modules-add-keeps-config", "config/config-base-file"],
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
      containments: ["project-start/start-base-build", "config/config-base-file"],
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
      containments: [],
      why: "the published exports, the ajs command and flag tree, and the config keys consumers rely on",
    },
    outbound: {
      globs: ["src/cli/version-check.ts", "src/cli/commands/update.ts", "src/cli/global-package-manager.ts", "src/cli/plugin.ts"],
      funnels: ["src/cli/version-check.ts", "src/cli/global-package-manager.ts"],
      containments: [],
      why: "these contact the npm registry or install packages globally on the user's machine",
    },
    exposure: {
      globs: ["src/logging/**", "src/core/output/failures.ts", "src/core/config/config-vars.ts", "src/core/config/config-var-*.ts", "src/cli/commands/config/show*.ts"],
      funnels: [],
      containments: [],
      why: "these print configuration values, environment-provided secrets and error details",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      containments: [],
      why: "the package name, its files and the release workflow claim names in the npm registry",
    },
  },
  formal: [
    {
      name: "formal-module-lifecycle",
      covers: [
        "src/cli/common.ts",
        "src/core/config/config-loader.ts",
        "src/core/modules/module-lifecycle.ts",
        "src/core/modules/module-manager-bindings.ts",
        "src/core/modules/module-manager-cache.ts",
        "src/core/modules/module-manager-construction.ts",
        "src/core/modules/module-manager-lifecycle.ts",
        "src/core/modules/module-manager-records.ts",
        "src/core/modules/module.ts",
        "src/core/repl/project-launch.ts",
        "src/core/runtime/launch-sequence.ts",
        "src/core/runtime/launch-steps.ts",
        "src/core/runtime/module-reloading.ts",
        "src/core/runtime/process-claim.ts",
        "src/core/runtime/runtime-bootstrap.ts",
        "src/core/runtime/shutdown/shutdown-manager.ts",
        "src/core/runtime/watch/file-watcher.ts",
        "src/core/runtime/watch/hot-reload.ts",
      ],
      command: ["node", ".agents/skills/formal-module-lifecycle/check.mjs"],
      violation: /^(?:finding|BROKEN) (\w+)/gm,
    },
    {
      name: "formal-interface-ranges",
      covers: [
        "src/core/modules/module-manager-packages.ts",
        "src/core/modules/module-manager-construction.ts",
        "src/core/output/interface-resolution-error.ts",
      ],
      command: ["pnpm", "exec", "mocha", "--no-config", "--require", "ts-node/register", "--require", "test/setup.ts", "test/core/module-manager.interface-ranges.test.ts", "--exit"],
      violation: null,
    },
  ],
};

export default config;
