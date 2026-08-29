import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface PackedManifest {
  dependencies?: Record<string, string>;
}

const root = path.resolve(__dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-package-consumer-"));
const packFolder = path.join(temp, "pack");
const consumerFolder = path.join(temp, "consumer");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function packCore(): string {
  fs.mkdirSync(packFolder, { recursive: true });
  run(pnpm, ["pack", "--pack-destination", packFolder, "--json"], root);
  const tarball = fs
    .readdirSync(packFolder)
    .find((file) => file.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("pnpm pack did not produce a tarball.");
  }
  return path.join(packFolder, tarball);
}

function inspectManifest(tarball: string): void {
  const content = run("tar", ["-xOf", tarball, "package/package.json"], root);
  const manifest = JSON.parse(content) as PackedManifest;
  if (
    manifest.dependencies?.["@antelopejs/interface-core"] !== ">=0.0.12 <1.0.0"
  ) {
    throw new Error(
      "Packed core does not support compatible interface-core 0.x releases.",
    );
  }
  if (/github:AntelopeJS\/interface-core|patches\//.test(content)) {
    throw new Error(
      "Packed core contains a workspace-only dependency override.",
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
        "@antelopejs/interface-core": "0.0.12",
        "reflect-metadata": "0.2.2",
      },
    }),
  );
  run(pnpm, ["install", "--ignore-workspace"], consumerFolder);
}

function verifyConsumer(): void {
  const source = path.join(__dirname, "verify.cjs");
  const target = path.join(consumerFolder, "verify.cjs");
  fs.copyFileSync(source, target);
  run(process.execPath, [target], consumerFolder);
}

try {
  const tarball = packCore();
  inspectManifest(tarball);
  installConsumer(tarball);
  verifyConsumer();
  process.stdout.write("Package consumer routing verified.\n");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
