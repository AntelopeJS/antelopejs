import { expect } from 'chai';
import { getModulePackageManager, getInstallCommand } from '../../../src/core/cli/package-manager';
import { InMemoryFileSystem } from '../../../src/core/filesystem';

describe('Package Manager Utils', () => {
  describe('getModulePackageManager', () => {
    it('should detect npm from package.json', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'npm@10.2.4' }));
      const pm = await getModulePackageManager('/project', fs);
      expect(pm).to.equal('npm');
    });

    it('should detect pnpm from packageManager field', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'pnpm@10.6.5' }));
      const pm = await getModulePackageManager('/project', fs);
      expect(pm).to.equal('pnpm');
    });
  });

  describe('getInstallCommand', () => {
    it('should return npm install for npm', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'npm@10.2.4' }));
      const cmd = await getInstallCommand('/project', true, fs);
      expect(cmd).to.include('npm');
      expect(cmd).to.include('install');
    });
  });
});
