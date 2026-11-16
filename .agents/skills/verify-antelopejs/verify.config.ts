/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs and declared funnel modules. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  why: string;
}

/**
 * A formal check: the source files it covers, the check's own files, the
 * command that runs it, and how its output names a violated rule (without
 * `violation`, a non-zero exit is the one rule `property` broken).
 */
export interface FormalCheck {
  name: string;
  covers: string[];
  files: string[];
  command: string[];
  violation: RegExp | null;
}

/**
 * The repo-owned layer of the verification skill. `shared` globs the files
 * every feature depends on: a diff that changes one runs every feature.
 */
export interface VerifyConfig {
  shared: string[];
  doors: Record<DoorKind, DoorRule | null>;
  formal: FormalCheck[];
}

const config: VerifyConfig = {
  shared: ["package.json", "pnpm-lock.yaml", "tsconfig.json", ".nvmrc"],
  doors: {
    data: {
      globs: [
        "src/cli/common.ts",
        "src/cli/config-source*.ts",
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
        "src/cli/config-source*.ts",
        "src/cli/version-check.ts",
        "src/core/modules/module-locks.ts",
      ],
      funnels: [],
      why: "build.json, the antelope.config.ts layout, antelope-lock/ and ~/.antelopejs files must stay readable by the next version",
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
  formal: [
    {
      name: "formal-module-lifecycle",
      covers: [
        "src/cli/common.ts",
        "src/core/config/config-loader.ts",
        "src/core/config/ts-config-file.ts",
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
      files: [".agents/skills/formal-module-lifecycle/**"],
      command: ["node", ".agents/skills/formal-module-lifecycle/check.mjs"],
      violation: /^(?:finding|BROKEN) (\w+)/gm,
    },
    {
      name: "formal-interface-ranges",
      covers: [
        "src/core/modules/module-manager-packages.ts",
        "src/core/modules/module-manager-construction.ts",
        "src/core/output/interface-resolution-error.ts",
        "src/version-ranges/index.ts",
      ],
      command: ["pnpm", "exec", "mocha", "--no-config", "--require", "ts-node/register", "--require", "test/setup.ts", "test/core/module-manager.interface-ranges.test.ts", "--exit"],
      files: ["test/core/module-manager.interface-ranges.test.ts"],
      violation: null,
    },
    {
      name: "formal-module-cache-lock",
      covers: [
        "src/core/downloaders/git.ts",
        "src/core/downloaders/package.ts",
        "src/core/downloaders/utils.ts",
        "src/core/modules/cache-leases.ts",
        "src/core/modules/cache-lock.ts",
        "src/core/modules/module-cache.ts",
      ],
      files: [".agents/skills/formal-module-cache-lock/**"],
      command: ["node", ".agents/skills/formal-module-cache-lock/check.mjs"],
      violation: /^(?:finding|BROKEN) (\w+)/gm,
    },
    {
      name: "formal-build-start",
      covers: [
        "src/core/build/index.ts",
        "src/core/modules/build-artifact.ts",
        "src/core/modules/module-cache.ts",
        "src/core/runtime/build-refresh.ts",
        "src/core/runtime/build-runtime.ts",
        "src/core/runtime/cache-pruning.ts",
        "src/core/runtime/launch-sequence.ts",
      ],
      files: [".agents/skills/formal-build-start/**"],
      command: ["node", ".agents/skills/formal-build-start/check.mjs"],
      violation: /^(?:finding|BROKEN) (\w+)/gm,
    },
    {
      name: "formal-binding-graph",
      covers: [
        "src/core/modules/interface-registry.ts",
        "src/core/modules/module-manager-bindings.ts",
        "src/core/resolution/binding-diagnostics.ts",
        "src/core/resolution/binding-graph-instances.ts",
        "src/core/resolution/binding-graph-types.ts",
        "src/core/resolution/binding-graph.ts",
        "src/core/resolution/binding-providers.ts",
      ],
      command: ["pnpm", "exec", "mocha", "--no-config", "--require", "ts-node/register", "--require", "test/setup.ts", "test/core/resolution/binding-graph.properties.test.ts", "test/integration/interface-binding.properties.test.ts", "--exit"],
      files: ["test/core/resolution/binding-graph.properties.test.ts", "test/integration/interface-binding.properties.test.ts"],
      violation: null,
    },
    {
      name: "formal-watched-folders",
      covers: [
        "src/core/runtime/watch/file-hasher.ts",
        "src/core/runtime/watch/file-watcher.ts",
        "src/core/runtime/watch/missing-folders.ts",
      ],
      command: ["pnpm", "exec", "mocha", "--no-config", "--require", "ts-node/register", "--require", "test/setup.ts", "test/core/watch/file-watcher.folders.property.test.ts", "--exit"],
      files: [
        ".agents/skills/formal-watched-folders/**",
        "test/core/watch/file-watcher.folders.property.test.ts",
        "test/helpers/watch-folder-scenario.ts",
        "test/helpers/watch-folder-world.ts",
      ],
      violation: null,
    },
  ],
};

export default config;
