import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listDirectory } from "../helpers/temp";

interface PackedManifest {
  dependencies?: Record<string, string>;
  antelopeJs?: PackedAntelopeJsManifest;
}

interface PackedAntelopeJsManifest {
  skills?: string[];
}

const root = path.resolve(__dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-package-consumer-"));
const packFolder = path.join(temp, "pack");
const consumerFolder = path.join(temp, "consumer");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const builtEntry = path.join(root, "dist", "index.js");
const skillsFolder = "skills";
const skillFile = "SKILL.md";
const interfaceCoreTarball = process.env.ANTELOPE_INTERFACE_CORE_TARBALL;
const interfaceCoreSpec = interfaceCoreTarball
  ? `file:${interfaceCoreTarball}`
  : "0.2.5";

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
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
  const manifest: PackedManifest = JSON.parse(content);
  if (
    manifest.dependencies?.["@antelopejs/interface-core"] !== ">=0.3.0 <0.4.0"
  ) {
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
  const manifest: PackedManifest = JSON.parse(content);
  if (!manifest.antelopeJs?.skills?.includes(`./${skillsFolder}`)) {
    throw new Error("Packed core does not declare its agent skills.");
  }
  const packedFiles = run("tar", ["-tf", tarball], root).split("\n");
  const missing = listDirectory(path.join(root, skillsFolder))
    .map((skill) => `package/${skillsFolder}/${skill}/${skillFile}`)
    .filter((file) => !packedFiles.includes(file));
  if (missing.length > 0) {
    throw new Error(`Packed core misses agent skills: ${missing.join(", ")}`);
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

function verifyConsumer(script: string): void {
  const source = path.join(__dirname, script);
  const target = path.join(consumerFolder, script);
  fs.copyFileSync(source, target);
  run(process.execPath, [target], consumerFolder);
}

try {
  const tarball = packCore();
  inspectManifest(tarball);
  inspectSkills(tarball);
  installConsumer(tarball);
  verifyConsumer("verify.cjs");
  verifyConsumer("verify-cli.cjs");
  verifyConsumer("verify-cli-api.cjs");
  process.stdout.write(
    "Package consumer routing, CLI startup and CLI API verified.\n",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
