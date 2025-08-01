import { homedir } from 'os';
import { ModuleSource } from '../common/downloader';
import { ExecuteCMD } from '../utils/command';
import path from 'path';
import { stat } from 'fs/promises';
import fs, { cpSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { getInstallPackagesCommand } from '../utils/package-manager';
import { acquireLock } from '../utils/lock';
import { terminalDisplay } from '../logging/terminal-display';

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

async function loadGit(git: string, branch?: string): Promise<string> {
  const folderName = git.replace(/[^a-zA-Z0-9_]/g, '_');
  const cachePath = path.join(homedir(), '.antelopejs', 'cache');

  if (!(await stat(cachePath).catch(() => false))) {
    mkdirSync(cachePath, { recursive: true });
  }

  const folderPath = path.join(cachePath, folderName);

  if (!(await stat(folderPath).catch(() => false))) {
    await setupGit(cachePath, git, folderName, branch);
  } else {
    await ExecuteCMD('git pull', { cwd: folderPath });
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
    const manifestPath = path.join(folderPath, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
  const releaseLock = await acquireLock(`git-${git}`);
  try {
    const folderPath = await loadGit(git);

    await ExecuteCMD(`git sparse-checkout add interfaces/${interface_}/manifest.json --skip-checks`, {
      cwd: folderPath,
    });

    const interfaceInfo = await getInterfaceInfo(folderPath, interface_);

    return interfaceInfo;
  } finally {
    await releaseLock();
  }
}

export async function loadInterfacesFromGit(git: string, interfaces: string[]): Promise<Record<string, InterfaceInfo>> {
  const releaseLock = await acquireLock(`git-${git}`);
  try {
    const folderPath = await loadGit(git);

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
  } finally {
    await releaseLock();
  }
}

export async function installInterfaces(
  git: string,
  module: string,
  interfacesToInstall: { interfaceInfo: InterfaceInfo; version: string }[],
) {
  const resolvedModulePath = path.resolve(module);

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
      const releaseLock = await acquireLock(`git-${files.remote}`);
      try {
        const gitPath = await loadGit(files.remote, files.branch);

        if (!gitOperations[gitPath]) {
          gitOperations[gitPath] = { path: gitPath, checkoutPaths: [] };
        }

        gitOperations[gitPath].checkoutPaths.push(`${files.path}/${version}`, `${files.path}/${version}.d.ts`);
      } finally {
        await releaseLock();
      }
    }
  }

  // Execute git operations in batches with locking
  for (const gitOp of Object.values(gitOperations)) {
    const folderName = path.basename(gitOp.path);
    const releaseLock = await acquireLock(`git-${folderName}`);
    try {
      await terminalDisplay.startSpinner(`Updating git sparse-checkout for ${folderName}`);
      await ExecuteCMD(`git sparse-checkout add ${gitOp.checkoutPaths.join(' ')} --skip-checks`, {
        cwd: gitOp.path,
      });
      await terminalDisplay.stopSpinner(`Updated git sparse-checkout for ${folderName}`);
    } finally {
      await releaseLock();
    }
  }

  // Copy interface files
  for (const { interfaceInfo, version } of allDependencies) {
    const files = interfaceInfo.manifest.files[version];
    let folderPath = '';

    if (files.type === 'local') {
      folderPath = path.resolve(interfaceInfo.folderPath);
    } else if (files.type === 'git' && files.remote) {
      const releaseLock = await acquireLock(`git-${files.remote}`);
      try {
        const gitPath = await loadGit(files.remote, files.branch);
        folderPath = path.join(gitPath, files.path);
      } finally {
        await releaseLock();
      }
    } else {
      throw new Error('Invalid interface files type');
    }

    const antelopePath = path.join(resolvedModulePath, '.antelope');
    const interfacesPath = path.join(antelopePath, 'interfaces.d');

    // Determine source and destination paths
    const isDirectory = await stat(path.join(folderPath, version)).catch(() => false);
    const interfacePath = isDirectory
      ? path.join(interfacesPath, interfaceInfo.name, version)
      : path.join(interfacesPath, interfaceInfo.name);

    // Ensure destination directory exists
    if (!(await stat(interfacePath).catch(() => false))) {
      mkdirSync(interfacePath, { recursive: true });
    }

    // Copy files
    const sourcePath = isDirectory ? path.join(folderPath, version) : path.join(folderPath, `${version}.d.ts`);
    const destPath = isDirectory ? interfacePath : path.join(interfacePath, `${version}.d.ts`);

    await terminalDisplay.startSpinner(`Copying interface files for ${interfaceInfo.name}@${version}`);
    cpSync(sourcePath, destPath, isDirectory ? { recursive: true } : {});
    await terminalDisplay.stopSpinner(`Copied interface files for ${interfaceInfo.name}@${version}`);

    const dependencies = interfaceInfo.manifest.dependencies[version];
    if (dependencies.packages.length > 0) {
      const installCmd = await getInstallPackagesCommand(dependencies.packages, true, interfacePath);
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
