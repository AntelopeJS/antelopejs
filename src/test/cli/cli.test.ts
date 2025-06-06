import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';

describe('AntelopeJS CLI - Main Tests', () => {
  const _cliPath = join(__dirname, '../../cli/index.js');
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await mkdtemp(join(tmpdir(), 'antelope-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  // Add your tests here - you can now use:
  // const { code, output, stderr } = await runCLI(cliPath, ['command', 'args'], { options });
});
