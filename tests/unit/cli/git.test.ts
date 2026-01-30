import { expect, sinon } from '../../helpers/setup';
import * as fs from 'fs/promises';
import { existsSync, readdirSync, mkdirSync, rmSync, cpSync, linkSync } from 'fs';
import {
  GitManifest,
  Template,
  InterfaceInfo,
  InterfaceManifest,
  InterfaceFiles,
  InterfaceDependencies,
  ModuleInterfaceInfo,
} from '../../../src/cli/git';

describe('cli/git', () => {
  describe('GitManifest interface', () => {
    it('should have starredInterfaces array', () => {
      const manifest: GitManifest = {
        starredInterfaces: ['interface1', 'interface2'],
        templates: [],
      };

      expect(manifest.starredInterfaces).to.be.an('array');
      expect(manifest.starredInterfaces).to.include('interface1');
    });

    it('should have templates array', () => {
      const manifest: GitManifest = {
        starredInterfaces: [],
        templates: [
          {
            name: 'basic',
            description: 'Basic template',
            repository: 'https://github.com/example/repo',
            branch: 'main',
          },
        ],
      };

      expect(manifest.templates).to.be.an('array');
      expect(manifest.templates[0].name).to.equal('basic');
    });
  });

  describe('Template interface', () => {
    it('should have required properties', () => {
      const template: Template = {
        name: 'test-template',
        description: 'A test template',
        repository: 'https://github.com/test/repo',
        branch: 'main',
      };

      expect(template.name).to.equal('test-template');
      expect(template.description).to.equal('A test template');
      expect(template.repository).to.equal('https://github.com/test/repo');
      expect(template.branch).to.equal('main');
    });

    it('should accept optional interfaces', () => {
      const template: Template = {
        name: 'test',
        description: 'Test',
        repository: 'https://github.com/test/repo',
        branch: 'main',
        interfaces: ['logging', 'database'],
      };

      expect(template.interfaces).to.deep.equal(['logging', 'database']);
    });
  });

  describe('InterfaceInfo interface', () => {
    it('should have all required properties', () => {
      const info: InterfaceInfo = {
        name: 'test-interface',
        folderPath: '/path/to/interface',
        gitPath: '/path/to/git',
        manifest: {
          description: 'Test interface',
          versions: ['beta'],
          modules: [],
          files: {},
          dependencies: {},
        },
      };

      expect(info.name).to.equal('test-interface');
      expect(info.folderPath).to.be.a('string');
      expect(info.manifest).to.have.property('description');
    });
  });

  describe('InterfaceManifest interface', () => {
    it('should have description', () => {
      const manifest: InterfaceManifest = {
        description: 'A test interface',
        versions: ['1.0', 'beta'],
        modules: [],
        files: {},
        dependencies: {},
      };

      expect(manifest.description).to.equal('A test interface');
    });

    it('should have versions array', () => {
      const manifest: InterfaceManifest = {
        description: '',
        versions: ['1.0.0', '2.0.0', 'beta'],
        modules: [],
        files: {},
        dependencies: {},
      };

      expect(manifest.versions).to.include('beta');
    });

    it('should have modules array', () => {
      const manifest: InterfaceManifest = {
        description: '',
        versions: [],
        modules: [
          {
            name: 'test-module',
            source: { type: 'package', package: '@test/mod', version: '1.0.0' } as any,
            versions: ['beta'],
          },
        ],
        files: {},
        dependencies: {},
      };

      expect(manifest.modules).to.have.length(1);
    });
  });

  describe('InterfaceFiles interface', () => {
    it('should handle local type', () => {
      const files: InterfaceFiles = {
        type: 'local',
        path: './interfaces/test',
      };

      expect(files.type).to.equal('local');
      expect(files.path).to.equal('./interfaces/test');
    });

    it('should handle git type with remote', () => {
      const files: InterfaceFiles = {
        type: 'git',
        remote: 'https://github.com/example/interfaces',
        branch: 'main',
        path: 'interfaces/test',
      };

      expect(files.type).to.equal('git');
      expect(files.remote).to.be.a('string');
      expect(files.branch).to.equal('main');
    });
  });

  describe('InterfaceDependencies interface', () => {
    it('should have packages array', () => {
      const deps: InterfaceDependencies = {
        packages: ['chalk', 'commander'],
        interfaces: [],
      };

      expect(deps.packages).to.include('chalk');
    });

    it('should have interfaces array', () => {
      const deps: InterfaceDependencies = {
        packages: [],
        interfaces: ['core@beta', 'logging@beta'],
      };

      expect(deps.interfaces).to.include('core@beta');
    });
  });

  describe('ModuleInterfaceInfo interface', () => {
    it('should have required properties', () => {
      const info: ModuleInterfaceInfo = {
        name: 'test-module',
        source: { type: 'package', package: '@test/module', version: '1.0.0' } as any,
        versions: ['beta', '1.0'],
      };

      expect(info.name).to.equal('test-module');
      expect(info.source.type).to.equal('package');
      expect(info.versions).to.include('beta');
    });
  });
});
