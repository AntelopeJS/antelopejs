import { expect } from 'chai';
import path from 'path';
import { findConfigPath, tryFindConfigPath, getModuleConfigPath } from '../../../src/core/config/config-paths';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';

describe('config-paths', () => {
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
  });

  describe('findConfigPath', () => {
    it('returns .ts path when it exists', async () => {
      await fs.writeFile('/project/antelope.config.ts', '');

      const result = await findConfigPath('/project', fs);

      expect(result).to.equal(path.resolve('/project', 'antelope.config.ts'));
    });

    it('throws when neither config file exists', async () => {
      try {
        await findConfigPath('/project', fs);
        expect.fail('should have thrown');
      } catch (error: any) {
        expect(error.message).to.include('No configuration file found');
        expect(error.message).to.include('antelope.config.ts');
      }
    });
  });

  describe('tryFindConfigPath', () => {
    it('returns .ts path when it exists', async () => {
      await fs.writeFile('/project/antelope.config.ts', '');

      const result = await tryFindConfigPath('/project', fs);

      expect(result).to.equal(path.resolve('/project', 'antelope.config.ts'));
    });

    it('returns undefined when neither exists', async () => {
      const result = await tryFindConfigPath('/project', fs);

      expect(result).to.be.undefined;
    });
  });

  describe('getModuleConfigPath', () => {
    it('builds the correct path', () => {
      const result = getModuleConfigPath('/project', 'database');

      expect(result).to.equal(path.resolve('/project', 'antelope.database.json'));
    });
  });
});
