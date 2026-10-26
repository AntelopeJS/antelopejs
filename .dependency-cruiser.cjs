const modules = [
  { name: "cli", path: "src/(?:cli|core/cli)", layer: 1 },
  { name: "embedded", path: "src/core/embedded", layer: 2 },
  { name: "test", path: "src/core/test", layer: 2 },
  { name: "build", path: "src/core/build", layer: 2 },
  { name: "repl", path: "src/core/repl", layer: 2.5 },
  { name: "runtime", path: "src/core/runtime", layer: 3 },
  { name: "downloaders", path: "src/core/downloaders", layer: 4 },
  { name: "modules", path: "src/core/modules", layer: 4.3 },
  { name: "resolution", path: "src/core/resolution", layer: 4.6 },
  { name: "config", path: "src/core/config", layer: 5 },
  { name: "logging", path: "src/logging", layer: 6 },
  { name: "output", path: "src/core/output", layer: 6.2 },
  { name: "filesystem", path: "src/core/filesystem", layer: 6.4 },
  { name: "utils", path: "src/utils", layer: 6.6 },
  { name: "types", path: "src/types", layer: 6.8 },
];

module.exports = {
  forbidden: [
    {
      name: "no-unresolved",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-importing-package-facade",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/index\\.ts$" },
      to: { path: "^src/index\\.ts$" },
    },
    ...modules.flatMap((module) => [
      {
        name: `${module.name}-entry-only`,
        severity: "error",
        from: {
          pathNot:
            module.name === "output"
              ? `^(?:${module.path}/|src/core/cli/public\\.ts$)`
              : `^${module.path}/`,
        },
        to: {
          path: `^${module.path}/`,
          pathNot:
            module.name === "cli"
              ? `^${module.path}/(?:index|public)\\.ts$`
              : `^${module.path}/index\\.ts$`,
        },
      },
      {
        name: `${module.name}-no-upward-imports`,
        severity: "error",
        from: { path: `^${module.path}/` },
        to: {
          path: `^(?:${
            modules
              .filter(
                (other) => other !== module && other.layer <= module.layer,
              )
              .map((other) => `${other.path}/`)
              .join("|") || "(?!)"
          })`,
        },
      },
      {
        name: `${module.name}-no-cross-module-cycles`,
        severity: "error",
        from: { path: `^${module.path}/` },
        to: {
          path: "^src/",
          pathNot: `^${module.path}/`,
          circular: true,
        },
      },
    ]),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "^(?:src|test)/.*\\.ts$",
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["require", "node", "default"],
      mainFields: ["main", "types"],
    },
  },
};
