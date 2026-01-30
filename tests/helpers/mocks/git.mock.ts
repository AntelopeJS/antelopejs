import sinon, { SinonStub } from 'sinon';
import * as git from '../../../src/cli/git';

export interface GitManifestMock {
  starredInterfaces: string[];
  templates: git.Template[];
}

export interface InterfaceInfoMock {
  name: string;
  folderPath: string;
  gitPath: string;
  manifest: git.InterfaceManifest;
}

export interface GitMockContext {
  stubs: {
    loadManifestFromGit: SinonStub;
    loadInterfaceFromGit: SinonStub;
    loadInterfacesFromGit: SinonStub;
    installInterface: SinonStub;
    installInterfaces: SinonStub;
    removeInterface: SinonStub;
    copyTemplate: SinonStub;
    createAjsSymlinks: SinonStub;
  };
  setManifest: (manifest: GitManifestMock) => void;
  setInterface: (name: string, info: InterfaceInfoMock) => void;
  setInterfaces: (interfaces: Record<string, InterfaceInfoMock>) => void;
  restore: () => void;
}

export function createMockGit(): GitMockContext {
  let manifest: GitManifestMock = { starredInterfaces: [], templates: [] };
  const interfaces = new Map<string, InterfaceInfoMock>();

  const loadManifestFromGit = sinon.stub(git, 'loadManifestFromGit').callsFake(async () => manifest);

  const loadInterfaceFromGit = sinon.stub(git, 'loadInterfaceFromGit').callsFake(async (_git, name) => {
    return interfaces.get(name);
  });

  const loadInterfacesFromGit = sinon.stub(git, 'loadInterfacesFromGit').callsFake(async (_git, names) => {
    const result: Record<string, git.InterfaceInfo> = {};
    for (const name of names) {
      const info = interfaces.get(name);
      if (info) {
        result[name] = info as git.InterfaceInfo;
      }
    }
    return result;
  });

  const installInterface = sinon.stub(git, 'installInterface').resolves();
  const installInterfaces = sinon.stub(git, 'installInterfaces').resolves();
  const removeInterface = sinon.stub(git, 'removeInterface').resolves();
  const copyTemplate = sinon.stub(git, 'copyTemplate').resolves();
  const createAjsSymlinks = sinon.stub(git, 'createAjsSymlinks').resolves();

  return {
    stubs: {
      loadManifestFromGit,
      loadInterfaceFromGit,
      loadInterfacesFromGit,
      installInterface,
      installInterfaces,
      removeInterface,
      copyTemplate,
      createAjsSymlinks,
    },
    setManifest: (m: GitManifestMock) => {
      manifest = m;
    },
    setInterface: (name: string, info: InterfaceInfoMock) => {
      interfaces.set(name, info);
    },
    setInterfaces: (infos: Record<string, InterfaceInfoMock>) => {
      interfaces.clear();
      for (const [name, info] of Object.entries(infos)) {
        interfaces.set(name, info);
      }
    },
    restore: () => sinon.restore(),
  };
}
