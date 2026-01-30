import sinon from 'sinon';
import type { GitManifest, InterfaceInfo, InterfaceManifest, Template } from '../../../src/cli/git';

/**
 * Interface for git helper mocks - used with proxyquire for module injection
 */
export interface MockGitHelpers {
  loadManifestFromGit: sinon.SinonStub;
  loadInterfaceFromGit: sinon.SinonStub;
  loadInterfacesFromGit: sinon.SinonStub;
  installInterface: sinon.SinonStub;
  installInterfaces: sinon.SinonStub;
  removeInterface: sinon.SinonStub;
  copyTemplate: sinon.SinonStub;
  createAjsSymlinks: sinon.SinonStub;
}

/**
 * Creates a set of mock git helper stubs for use with proxyquire
 * These stubs are not attached to the actual module, allowing for flexible test configuration
 */
export function createMockGitHelpers(): MockGitHelpers {
  return {
    loadManifestFromGit: sinon.stub(),
    loadInterfaceFromGit: sinon.stub(),
    loadInterfacesFromGit: sinon.stub(),
    installInterface: sinon.stub(),
    installInterfaces: sinon.stub(),
    removeInterface: sinon.stub(),
    copyTemplate: sinon.stub(),
    createAjsSymlinks: sinon.stub(),
  };
}

/**
 * Creates a mock GitManifest object with sensible defaults
 * @param overrides - Optional partial GitManifest to override defaults
 */
export function createMockGitManifest(overrides?: Partial<GitManifest>): GitManifest {
  return {
    starredInterfaces: ['logging', 'database'],
    templates: [
      {
        name: 'basic',
        description: 'Basic module template',
        repository: 'https://github.com/test/template',
        branch: 'main',
        interfaces: [],
      },
    ],
    ...overrides,
  };
}

/**
 * Creates a mock Template object with sensible defaults
 * @param overrides - Optional partial Template to override defaults
 */
export function createMockTemplate(overrides?: Partial<Template>): Template {
  return {
    name: 'basic',
    description: 'Basic module template',
    repository: 'https://github.com/test/template',
    branch: 'main',
    interfaces: [],
    ...overrides,
  };
}

/**
 * Creates a mock InterfaceManifest object with sensible defaults
 * @param name - Interface name
 * @param versions - Array of version strings
 */
export function createMockInterfaceManifest(name: string, versions: string[] = ['beta']): InterfaceManifest {
  const files: Record<string, { type: 'local'; path: string }> = {};
  const dependencies: Record<string, { packages: string[]; interfaces: string[] }> = {};

  for (const version of versions) {
    files[version] = { type: 'local', path: `./interfaces/${name}` };
    dependencies[version] = { packages: [], interfaces: [] };
  }

  return {
    description: `Mock ${name} interface`,
    versions,
    modules: [],
    files,
    dependencies,
  };
}

/**
 * Creates a mock InterfaceInfo object with sensible defaults
 * @param name - Interface name
 * @param versions - Array of version strings (defaults to ['beta'])
 * @param overrides - Optional partial InterfaceInfo to override computed values
 */
export function createMockInterfaceInfo(
  name: string,
  versions: string[] = ['beta'],
  overrides?: Partial<Omit<InterfaceInfo, 'manifest'> & { manifest?: Partial<InterfaceManifest> }>,
): InterfaceInfo {
  const manifest = createMockInterfaceManifest(name, versions);

  // Apply manifest overrides if provided
  if (overrides?.manifest) {
    Object.assign(manifest, overrides.manifest);
  }

  // Create base object without manifest override
  const { manifest: _manifestOverride, ...restOverrides } = overrides || {};

  return {
    name,
    folderPath: `/mock/interfaces/${name}`,
    gitPath: '/mock/git',
    ...restOverrides,
    // Ensure manifest is the computed one with any overrides applied
    manifest,
  };
}

/**
 * Creates a pre-configured set of mock git helpers with common default behaviors
 * Useful for quick test setup where you want reasonable defaults
 */
export function createMockGitHelpersWithDefaults(): MockGitHelpers {
  const mocks = createMockGitHelpers();

  // Set up default resolved values
  mocks.loadManifestFromGit.resolves(createMockGitManifest());
  mocks.loadInterfaceFromGit.resolves(undefined);
  mocks.loadInterfacesFromGit.resolves({});
  mocks.installInterface.resolves();
  mocks.installInterfaces.resolves();
  mocks.removeInterface.resolves();
  mocks.copyTemplate.resolves();
  mocks.createAjsSymlinks.resolves();

  return mocks;
}

/**
 * Creates mock git helpers configured for a specific interface
 * @param interfaceName - Name of the interface to mock
 * @param versions - Array of version strings
 */
export function createMockGitHelpersForInterface(
  interfaceName: string,
  versions: string[] = ['beta'],
): MockGitHelpers {
  const mocks = createMockGitHelpersWithDefaults();
  const interfaceInfo = createMockInterfaceInfo(interfaceName, versions);

  mocks.loadInterfaceFromGit.resolves(interfaceInfo);
  mocks.loadInterfacesFromGit.resolves({ [interfaceName]: interfaceInfo });

  return mocks;
}

/**
 * Creates mock git helpers configured for multiple interfaces
 * @param interfaces - Record of interface names to their version arrays
 */
export function createMockGitHelpersForInterfaces(
  interfaces: Record<string, string[]>,
): MockGitHelpers {
  const mocks = createMockGitHelpersWithDefaults();
  const interfaceInfos: Record<string, InterfaceInfo> = {};

  for (const [name, versions] of Object.entries(interfaces)) {
    interfaceInfos[name] = createMockInterfaceInfo(name, versions);
  }

  mocks.loadInterfaceFromGit.callsFake(async (_git: string, interfaceName: string) => {
    return interfaceInfos[interfaceName];
  });

  mocks.loadInterfacesFromGit.callsFake(async (_git: string, names: string[]) => {
    const result: Record<string, InterfaceInfo> = {};
    for (const name of names) {
      if (interfaceInfos[name]) {
        result[name] = interfaceInfos[name];
      }
    }
    return result;
  });

  return mocks;
}

/**
 * Helper type for proxyquire git module replacement
 */
export type ProxyquireGitModule = {
  loadManifestFromGit: sinon.SinonStub;
  loadInterfaceFromGit: sinon.SinonStub;
  loadInterfacesFromGit: sinon.SinonStub;
  installInterface: sinon.SinonStub;
  installInterfaces: sinon.SinonStub;
  removeInterface: sinon.SinonStub;
  copyTemplate: sinon.SinonStub;
  createAjsSymlinks: sinon.SinonStub;
};

/**
 * Creates a proxyquire-compatible git module replacement object
 * @param mocks - MockGitHelpers instance to use
 */
export function createProxyquireGitModule(mocks: MockGitHelpers): ProxyquireGitModule {
  return {
    loadManifestFromGit: mocks.loadManifestFromGit,
    loadInterfaceFromGit: mocks.loadInterfaceFromGit,
    loadInterfacesFromGit: mocks.loadInterfacesFromGit,
    installInterface: mocks.installInterface,
    installInterfaces: mocks.installInterfaces,
    removeInterface: mocks.removeInterface,
    copyTemplate: mocks.copyTemplate,
    createAjsSymlinks: mocks.createAjsSymlinks,
  };
}
