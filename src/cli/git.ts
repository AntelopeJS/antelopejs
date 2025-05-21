import { homedir } from 'os';
import { ModuleSource } from '../common/downloader';
import { ExecuteCMD } from '../utils/command';
import path from 'path';
import { stat } from 'fs/promises';
import fs, { cpSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { getInstallPackagesCommand } from './package-manager';

async function setupGit(cachePath: string, git: string, folderName: string, branch?: string) {
  const result = await ExecuteCMD(
    `git clone --filter=blob:none --no-checkout --depth 1 --sparse ${branch ? `--branch ${branch}` : ''} ${git} ${folderName}`,
    {
      cwd: cachePath,
    },
  );

  if (result.code !== 0) {
    throw new Error(`Failed to clone repository: ${result.stderr}`);
  }

  const sparseResult = await ExecuteCMD('git sparse-checkout add manifest.json --skip-checks', {
    cwd: path.join(cachePath, folderName),
  });

  if (sparseResult.code !== 0) {
    throw new Error(`Failed to setup sparse checkout: ${sparseResult.stderr}`);
  }

  const checkoutResult = await ExecuteCMD('git checkout', {
    cwd: path.join(cachePath, folderName),
  });

  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to checkout: ${checkoutResult.stderr}`);
  }
}

async function loadGit(git: string, requirePull: boolean, branch?: string): Promise<string> {
  const folderName = git.replace(/[^a-zA-Z0-9_]/g, '_');
  const cachePath = path.join(homedir(), '.antelopejs', 'cache');

  if (!(await stat(cachePath).catch(() => false))) {
    mkdirSync(cachePath, { recursive: true });
  }

  const folderPath = path.join(cachePath, folderName);

  if (!(await stat(folderPath).catch(() => false))) {
    await setupGit(cachePath, git, folderName, branch);
  } else if (requirePull) {
    await ExecuteCMD('git pull', { cwd: folderPath });
  } else {
    ExecuteCMD('git pull', { cwd: folderPath });
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
  const folderPath = await loadGit(git, false);
  const manifestPath = path.join(folderPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest;
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
  files: Record<string, InterfaceFiles>;
  dependencies: Record<string, InterfaceDependencies>;
}

export interface InterfaceFiles {
  type: 'git' | 'local';
  remote?: string;
  branch?: string;
  path: string;
}

export interface InterfaceDependencies {
  packages: string[];
  interfaces: string[];
}

export interface ModuleInterfaceInfo {
  name: string;
  source: ModuleSource;
  versions: string[];
}

async function getInterfaceInfo(gitPath: string, interface_: string): Promise<InterfaceInfo | undefined> {
  const iFolderPath = path.join(gitPath, 'interfaces', interface_);

  if (!(await stat(iFolderPath).catch(() => false))) {
    return undefined;
  }

  return {
    name: interface_,
    folderPath: iFolderPath,
    gitPath,
    manifest: require(path.join(iFolderPath, 'manifest.json')),
  };
}

export async function loadInterfaceFromGit(git: string, interface_: string): Promise<InterfaceInfo | undefined> {
  const folderPath = await loadGit(git, true);

  await ExecuteCMD(`git sparse-checkout add interfaces/${interface_}/manifest.json --skip-checks`, {
    cwd: folderPath,
  });

  const interfaceInfo = await getInterfaceInfo(folderPath, interface_);

  return interfaceInfo;
}

export async function loadInterfacesFromGit(git: string, interfaces: string[]): Promise<Record<string, InterfaceInfo>> {
  const folderPath = await loadGit(git, true);

  const sparseCheckoutPaths = interfaces.map((interface_) => `interfaces/${interface_}/manifest.json`).join(' ');

  await ExecuteCMD(`git sparse-checkout add ${sparseCheckoutPaths} --skip-checks`, { cwd: folderPath });

  const interfacesInfo: Record<string, InterfaceInfo> = {};

  for (const interface_ of interfaces) {
    const interfaceInfo = await getInterfaceInfo(folderPath, interface_);
    if (interfaceInfo) {
      interfacesInfo[interface_] = interfaceInfo;
    }
  }

  return interfacesInfo;
}

export async function installInterfaces(
  git: string,
  module: string,
  interfacesToInstall: { interfaceInfo: InterfaceInfo; version: string }[],
) {
  // First collect all the dependencies to avoid redundant git operations
  const allDependencies: { interfaceInfo: InterfaceInfo; version: string }[] = [];

  // Track processed interfaces to avoid duplicate processing
  const processedInterfaces = new Set<string>();

  // Keep track of all interface dependencies we need to load
  const interfaceDepsToLoad: { name: string; version: string }[] = [];

  // First pass: collect all direct interfaces and their dependencies
  for (const { interfaceInfo, version } of interfacesToInstall) {
    const interfaceKey = `${interfaceInfo.name}@${version}`;

    // Skip if already processed
    if (processedInterfaces.has(interfaceKey)) {
      continue;
    }

    processedInterfaces.add(interfaceKey);
    allDependencies.push({ interfaceInfo, version });

    // Collect dependencies
    const dependencies = interfaceInfo.manifest.dependencies[version];
    if (dependencies.interfaces.length > 0) {
      for (const dependency of dependencies.interfaces) {
        const [name, depVersion] = dependency.split('@');

        // Skip if already processed
        const depKey = `${name}@${depVersion}`;
        if (processedInterfaces.has(depKey)) {
          continue;
        }

        interfaceDepsToLoad.push({ name, version: depVersion });
      }
    }
  }

  // Load all interface dependencies in a single batch request
  if (interfaceDepsToLoad.length > 0) {
    // Get unique interface names
    const uniqueInterfaceNames = [...new Set(interfaceDepsToLoad.map((dep) => dep.name))];

    // Load all interfaces in one call
    const interfaces = await loadInterfacesFromGit(git, uniqueInterfaceNames);

    // Process dependencies
    for (const { name, version } of interfaceDepsToLoad) {
      const interfaceKey = `${name}@${version}`;

      // Skip if already processed (could have been added in a previous iteration)
      if (processedInterfaces.has(interfaceKey)) {
        continue;
      }

      const interfaceInfo = interfaces[name];
      if (interfaceInfo) {
        processedInterfaces.add(interfaceKey);
        allDependencies.push({ interfaceInfo, version });
      }
    }
  }

  // Group operations by git repository to minimize git operations
  const gitOperations: Record<string, { path: string; checkoutPaths: string[] }> = {};

  // Prepare git operations
  for (const { interfaceInfo, version } of allDependencies) {
    const files = interfaceInfo.manifest.files[version];
    if (files.type === 'local') {
      const gitPath = interfaceInfo.gitPath;
      const interfacePathBase = `interfaces/${interfaceInfo.name}`;

      if (!gitOperations[gitPath]) {
        gitOperations[gitPath] = { path: gitPath, checkoutPaths: [] };
      }

      gitOperations[gitPath].checkoutPaths.push(
        `${interfacePathBase}/${version}`,
        `${interfacePathBase}/${version}.d.ts`,
      );
    } else if (files.type === 'git' && files.remote) {
      const gitPath = await loadGit(files.remote, true, files.branch);

      if (!gitOperations[gitPath]) {
        gitOperations[gitPath] = { path: gitPath, checkoutPaths: [] };
      }

      gitOperations[gitPath].checkoutPaths.push(`${files.path}/${version}`, `${files.path}/${version}.d.ts`);
    }
  }

  // Execute git operations in batches
  for (const gitOp of Object.values(gitOperations)) {
    await ExecuteCMD(`git sparse-checkout add ${gitOp.checkoutPaths.join(' ')} --skip-checks`, {
      cwd: gitOp.path,
    });
  }

  // Copy interface files
  for (const { interfaceInfo, version } of allDependencies) {
    const files = interfaceInfo.manifest.files[version];
    let folderPath = '';

    if (files.type === 'local') {
      folderPath = interfaceInfo.folderPath;
    } else if (files.type === 'git' && files.remote) {
      const gitPath = await loadGit(files.remote, false, files.branch);
      folderPath = path.join(gitPath, files.path);
    } else {
      throw new Error('Invalid interface files type');
    }

    const antelopePath = path.join(module, '.antelope');
    const interfacesPath = path.join(antelopePath, 'interfaces.d');
    const interfacePath = path.join(interfacesPath, interfaceInfo.name, version);

    if (!(await stat(interfacePath).catch(() => false))) {
      mkdirSync(interfacePath, { recursive: true });
    }

    cpSync(path.join(folderPath, version), interfacePath, { recursive: true });

    const dependencies = interfaceInfo.manifest.dependencies[version];
    if (dependencies.packages.length > 0) {
      const installCmd = await getInstallPackagesCommand(dependencies.packages, true);
      await ExecuteCMD(installCmd, {
        cwd: interfacePath,
      });
    }
  }
}

// Keep the original function for backward compatibility, but refactor to use the new implementation
export async function installInterface(git: string, module: string, interfaceInfo: InterfaceInfo, version: string) {
  await installInterfaces(git, module, [{ interfaceInfo, version }]);
}

export async function removeInterface(module: string, name: string, version: string) {
  const antelopePath = path.join(module, '.antelope');
  const interfacesPath = path.join(antelopePath, 'interfaces.d');
  const interfaceRootPath = path.join(interfacesPath, name);
  const interfacePath = path.join(interfaceRootPath, version);

  if (await stat(interfacePath).catch(() => false)) {
    rmSync(interfacePath, { recursive: true });
  }

  if ((await stat(interfaceRootPath).catch(() => false)) && readdirSync(interfaceRootPath).length <= 0) {
    rmSync(interfaceRootPath, { recursive: true });
  }

  if ((await stat(interfacesPath).catch(() => false)) && readdirSync(interfacesPath).length <= 0) {
    rmSync(interfacesPath, { recursive: true });
  }

  if ((await stat(antelopePath).catch(() => false)) && readdirSync(antelopePath).length <= 0) {
    rmSync(antelopePath, { recursive: true });
  }
}

export async function copyTemplate(template: Template, distPath: string) {
  await mkdirSync(distPath, { recursive: true });
  await ExecuteCMD('git init', {
    cwd: distPath,
  });

  await ExecuteCMD(`git remote add origin ${template.repository}`, {
    cwd: distPath,
  });

  await ExecuteCMD('git fetch', {
    cwd: distPath,
  });

  await ExecuteCMD(`git reset --hard origin/${template.branch}`, {
    cwd: distPath,
  });

  rmSync(path.join(distPath, '.git'), { recursive: true, force: true });
}
