import fs, { mkdirSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ModuleSource } from "@antelopejs/interface-core/config";
import { acquireLock } from "../../utils/lock";
import { ExecuteCMD } from "./command";

async function setupGit(
  cachePath: string,
  git: string,
  folderName: string,
  branch?: string,
) {
  const result = await ExecuteCMD(
    `git clone --filter=blob:none --no-checkout --depth 1 --sparse ${branch ? `--branch ${branch}` : ""} ${git} ${folderName}`,
    {
      cwd: cachePath,
    },
  );

  if (result.code !== 0) {
    throw new Error(`Failed to clone repository: ${result.stderr}`);
  }

  const sparseResult = await ExecuteCMD(
    "git sparse-checkout add manifest.json --skip-checks",
    {
      cwd: path.join(cachePath, folderName),
    },
  );

  if (sparseResult.code !== 0) {
    throw new Error(`Failed to setup sparse checkout: ${sparseResult.stderr}`);
  }

  const checkoutResult = await ExecuteCMD("git checkout", {
    cwd: path.join(cachePath, folderName),
  });

  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to checkout: ${checkoutResult.stderr}`);
  }
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
  starredInterfaces: string[];
  templates: Template[];
}
export interface Template {
  name: string;
  description: string;
  repository: string;
  branch: string;
  interfaces?: string[];
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
  versions: string[];
  modules: ModuleInterfaceInfo[];
}

export interface ModuleInterfaceInfo {
  name: string;
  source: ModuleSource;
  versions: string[];
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

  await ExecuteCMD(`git reset --hard origin/${template.branch}`, {
    cwd: distPath,
  });

  rmSync(path.join(distPath, ".git"), { recursive: true, force: true });
}
