import type { ModuleSource } from "@antelopejs/interface-core/config";
import fs, { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { NextStep, PackageManagerName } from "../core/output";
import { ExecError, ExecuteCMD } from "../core/output";
import { acquireLock } from "./lock";

async function runGitCommand(command: string, cwd: string): Promise<void> {
  const result = await ExecuteCMD(command, { cwd });
  if (result.code !== 0) {
    throw new ExecError({ ...result, command });
  }
}

async function setupGit(
  cachePath: string,
  git: string,
  folderName: string,
  branch?: string,
) {
  const branchArgument = branch ? `--branch ${branch} ` : "";
  await runGitCommand(
    `git clone --filter=blob:none --no-checkout --depth 1 --sparse ${branchArgument}${git} ${folderName}`,
    cachePath,
  );
  const folderPath = path.join(cachePath, folderName);
  await runGitCommand(
    "git sparse-checkout add manifest.json --skip-checks",
    folderPath,
  );
  await runGitCommand("git checkout", folderPath);
}

async function loadGit(git: string, branch?: string): Promise<string> {
  const folderName = git.replace(/[^a-zA-Z0-9_]/g, "_");
  const cachePath = path.join(homedir(), ".antelopejs", "cache");

  if (!(await stat(cachePath).catch(() => false))) {
    mkdirSync(cachePath, { recursive: true });
  }

  const folderPath = path.join(cachePath, folderName);

  if (!(await stat(folderPath).catch(() => false))) {
    await setupGit(cachePath, git, folderName, branch);
  } else {
    await ExecuteCMD("git pull", { cwd: folderPath });
  }

  return folderPath;
}

export interface GitManifest {
  interfaces: Record<string, string>;
  starredInterfaces: string[];
  templates: Template[];
  projectTemplates?: Template[];
}
export interface Template {
  name: string;
  repository: string;
  branch: string;
  description?: string;
  packageManager?: PackageManagerName;
  nextSteps?: NextStep[];
}

export async function loadManifestFromGit(git: string): Promise<GitManifest> {
  const releaseLock = await acquireLock(`git-${git}`);
  try {
    const folderPath = await loadGit(git);
    const manifestPath = path.join(folderPath, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest;
  } finally {
    await releaseLock();
  }
}

export interface InterfaceInfo {
  name: string;
  folderPath: string;
  gitPath: string;
  manifest: InterfaceManifest;
}

export interface InterfaceManifest {
  description: string;
  package: string;
  modules: ModuleInterfaceInfo[];
}

export interface ModuleInterfaceInfo {
  name: string;
  source: ModuleSource;
}

async function getInterfaceInfo(
  gitPath: string,
  interface_: string,
): Promise<InterfaceInfo | undefined> {
  const iFolderPath = path.join(gitPath, "interfaces", interface_);

  if (!(await stat(iFolderPath).catch(() => false))) {
    return undefined;
  }

  return {
    name: interface_,
    folderPath: iFolderPath,
    gitPath,
    manifest: require(path.join(iFolderPath, "manifest.json")),
  };
}

export async function loadInterfaceFromGit(
  git: string,
  interface_: string,
): Promise<InterfaceInfo | undefined> {
  const releaseLock = await acquireLock(`git-${git}`);
  try {
    const folderPath = await loadGit(git);

    await ExecuteCMD(
      `git sparse-checkout add interfaces/${interface_}/manifest.json --skip-checks`,
      {
        cwd: folderPath,
      },
    );

    const interfaceInfo = await getInterfaceInfo(folderPath, interface_);

    return interfaceInfo;
  } finally {
    await releaseLock();
  }
}

export async function loadInterfacesFromGit(
  git: string,
  interfaces: string[],
): Promise<Record<string, InterfaceInfo>> {
  const releaseLock = await acquireLock(`git-${git}`);
  try {
    const folderPath = await loadGit(git);

    const sparseCheckoutPaths = interfaces
      .map((interface_) => `interfaces/${interface_}/manifest.json`)
      .join(" ");

    await ExecuteCMD(
      `git sparse-checkout add ${sparseCheckoutPaths} --skip-checks`,
      { cwd: folderPath },
    );

    const interfacesInfo: Record<string, InterfaceInfo> = {};

    for (const interface_ of interfaces) {
      const interfaceInfo = await getInterfaceInfo(folderPath, interface_);
      if (interfaceInfo) {
        interfacesInfo[interface_] = interfaceInfo;
      }
    }

    return interfacesInfo;
  } finally {
    await releaseLock();
  }
}

/**
 * Paths, relative to a template repository root and written with `/`, that a
 * scaffold never checks out: the template's own agent layer (its verification
 * skill and the symlinks that expose it). `.claude/settings.json` is not listed
 * because templates ship it on purpose. They are left out through a sparse
 * checkout, so files the target directory already holds at these paths are
 * kept.
 */
export const SCAFFOLD_EXCLUDED_PATHS = [".agents", ".claude/skills"] as const;

function scaffoldSparsePatterns(): string {
  const exclusions = SCAFFOLD_EXCLUDED_PATHS.flatMap((excluded) => [
    `!/${excluded}`,
    `!/${excluded}/`,
  ]);
  return ["/*", ...exclusions, ""].join("\n");
}

export async function copyTemplate(template: Template, distPath: string) {
  await mkdirSync(distPath, { recursive: true });
  await ExecuteCMD("git init", {
    cwd: distPath,
  });

  await ExecuteCMD(`git remote add origin ${template.repository}`, {
    cwd: distPath,
  });

  await ExecuteCMD("git fetch", {
    cwd: distPath,
  });

  await ExecuteCMD("git config core.sparseCheckout true", {
    cwd: distPath,
  });
  const gitInfo = path.join(distPath, ".git", "info");
  mkdirSync(gitInfo, { recursive: true });
  writeFileSync(
    path.join(gitInfo, "sparse-checkout"),
    scaffoldSparsePatterns(),
  );

  await ExecuteCMD(`git reset --hard origin/${template.branch}`, {
    cwd: distPath,
  });

  rmSync(path.join(distPath, ".git"), { recursive: true, force: true });
}
