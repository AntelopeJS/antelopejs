import { expect } from 'chai';
import {
  detectIndentation,
  readConfig,
} from '../../../src/core/cli/common';
import { InMemoryFileSystem } from '../../../src/core/filesystem';

describe('CLI Common', () => {
  describe('detectIndentation', () => {
    it('should detect 2-space indentation', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/test.json', '{\n  "a": 1\n}');
      const indent = await detectIndentation('/test.json', fs);
      expect(indent).to.equal('  ');
    });

    it('should detect tab indentation', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/test.json', '{\n\t"a": 1\n}');
      const indent = await detectIndentation('/test.json', fs);
      expect(indent).to.equal('\t');
    });
  });

  describe('readConfig', () => {
    it('should read antelope.json', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/antelope.json', '{"name":"test"}');
      const config = await readConfig('/project', fs);
      expect(config?.name).to.equal('test');
    });
  });
});
