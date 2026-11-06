import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildProcessInvocation } from "../../src/core/output";
import { isObject } from "../../src/utils";
import { overriddenInterfaceCore } from "../helpers/interface-core-override";
import { listDirectory } from "../helpers/temp";

const root = path.resolve(__dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-package-consumer-"));
const packFolder = path.join(temp, "pack");
const consumerFolder = path.join(temp, "consumer");
const pinnedFolder = path.join(temp, "pinned-consumer");
const pinnedInterfaceCore = "0.0.11";
const typeScriptCompiler = path.join(
  root,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const builtEntry = path.join(root, "dist", "index.js");
const skillsFolder = "skills";
const skillFile = "SKILL.md";
const interfaceCoreTarball =
  process.env.ANTELOPE_INTERFACE_CORE_TARBALL ?? overriddenInterfaceCore(root);
const interfaceCoreSpec = interfaceCoreTarball
  ? `file:${interfaceCoreTarball}`
  : "0.2.5";

function run(command: string, args: string[], cwd: string): string {
  const invocation = buildProcessInvocation(command, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status ?? result.signal}\n${result.stdout}`,
    );
  }
  return result.stdout;
}

function assertBuilt(): void {
  if (!fs.existsSync(builtEntry)) {
    throw new Error(
      `Missing ${path.relative(root, builtEntry)}; run pnpm build before packing.`,
    );
  }
}

function packCore(): string {
  assertBuilt();
  fs.mkdirSync(packFolder, { recursive: true });
  run(
    pnpm,
    [
      "pack",
      "--config.ignore-scripts=true",
      "--pack-destination",
      packFolder,
      "--json",
    ],
    root,
  );
  const tarball = listDirectory(packFolder).find((file) =>
    file.endsWith(".tgz"),
  );
  if (!tarball) {
    throw new Error("pnpm pack did not produce a tarball.");
  }
  return path.join(packFolder, tarball);
}

function inspectManifest(tarball: string): void {
  const content = run("tar", ["-xOf", tarball, "package/package.json"], root);
  const manifest: unknown = JSON.parse(content);
  const dependencies = isObject(manifest) ? manifest.dependencies : undefined;
  const interfaceCoreRange = isObject(dependencies)
    ? dependencies["@antelopejs/interface-core"]
    : undefined;
  if (interfaceCoreRange !== ">=0.4.0 <0.5.0") {
    throw new Error(
      "Packed core does not pin interface-core to the minor it implements.",
    );
  }
  if (/github:AntelopeJS\/interface-core|patches\//.test(content)) {
    throw new Error(
      "Packed core contains a workspace-only dependency override.",
    );
  }
}

function inspectSkills(tarball: string): void {
  const content = run("tar", ["-xOf", tarball, "package/package.json"], root);
  const manifest: unknown = JSON.parse(content);
  const antelopeJs = isObject(manifest) ? manifest.antelopeJs : undefined;
  const skills = isObject(antelopeJs) ? antelopeJs.skills : undefined;
  if (!Array.isArray(skills) || !skills.includes(`./${skillsFolder}`)) {
    throw new Error("Packed core does not declare its agent skills.");
  }
  const packedFiles = run("tar", ["-tf", tarball], root).split(/\r?\n/);
  const missing = listDirectory(path.join(root, skillsFolder))
    .map((skill) => `package/${skillsFolder}/${skill}/${skillFile}`)
    .filter((file) => !packedFiles.includes(file));
  if (missing.length > 0) {
    const packedSkills = packedFiles.filter((file) =>
      file.includes(`/${skillsFolder}/`),
    );
    throw new Error(
      `Packed core misses agent skills: ${missing.join(", ")}; packed: ${JSON.stringify(packedSkills)}`,
    );
  }
}

function installConsumer(tarball: string): void {
  fs.mkdirSync(consumerFolder, { recursive: true });
  fs.writeFileSync(
    path.join(consumerFolder, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "@antelopejs/core": `file:${tarball}`,
        "@antelopejs/interface-core": interfaceCoreSpec,
        "reflect-metadata": "0.2.2",
      },
    }),
  );
  if (!interfaceCoreTarball) {
    run(pnpm, ["install", "--ignore-workspace"], consumerFolder);
    return;
  }
  fs.writeFileSync(
    path.join(consumerFolder, "pnpm-workspace.yaml"),
    `overrides:\n  "@antelopejs/interface-core": ${JSON.stringify(interfaceCoreSpec)}\n`,
  );
  run(pnpm, ["install"], consumerFolder);
}

function verifyConsumer(script: string, folder = consumerFolder): void {
  const source = path.join(__dirname, script);
  const target = path.join(folder, script);
  fs.copyFileSync(source, target);
  run(process.execPath, [target], folder);
}

function verifyEs2020Types(): void {
  fs.writeFileSync(
    path.join(consumerFolder, "types.ts"),
    'export * from "@antelopejs/core";\n',
  );
  fs.writeFileSync(
    path.join(consumerFolder, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        lib: ["ES2020"],
        module: "commonjs",
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        typeRoots: [path.join(root, "node_modules", "@types")],
        types: ["node"],
      },
      files: ["types.ts"],
    }),
  );
  run(process.execPath, [typeScriptCompiler, "-p", "."], consumerFolder);
}

function installPinnedConsumer(tarball: string): void {
  fs.mkdirSync(pinnedFolder, { recursive: true });
  fs.writeFileSync(
    path.join(pinnedFolder, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "@antelopejs/core": `file:${tarball}`,
        "@antelopejs/interface-core": pinnedInterfaceCore,
        "reflect-metadata": "0.2.2",
      },
    }),
  );
  fs.writeFileSync(
    path.join(pinnedFolder, "pnpm-workspace.yaml"),
    `overrides:\n  "@antelopejs/interface-core": "${pinnedInterfaceCore}"\n`,
  );
  run(pnpm, ["install"], pinnedFolder);
}

try {
  const tarball = packCore();
  inspectManifest(tarball);
  inspectSkills(tarball);
  installConsumer(tarball);
  verifyConsumer("verify.cjs");
  verifyConsumer("verify-cli.cjs");
  verifyConsumer("verify-cli-api.cjs");
  verifyEs2020Types();
  installPinnedConsumer(tarball);
  verifyConsumer("verify-pinned-interface-core.cjs", pinnedFolder);
  process.stdout.write(
    "Package consumer routing, CLI startup, CLI API, ES2020 types and pinned interface-core verified.\n",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
