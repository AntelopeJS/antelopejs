import { expect } from '../helpers/setup';
import { runCLI, createTempDir, cleanupDir, fileExists, readJson } from '../helpers/integration';
import path from 'path';
import * as fsp from 'fs/promises';

describe('E2E: ajs project init', function () {
  this.timeout(60000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('e2e-project-init');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  it('should create antelope.json in specified directory', async () => {
    const projectName = 'my-test-project';
    const projectPath = path.join(testDir, projectName);

    // Provide stdin input for inquirer prompts:
    // 1. Project name (just press enter for default which is directory basename)
    // 2. "Do you have an existing app module?" - answer "n" (no)
    // 3. "Would you like to create a new app module now?" - answer "n" (no)
    const result = await runCLI(['project', 'init', projectPath], {
      stdin: '\nn\nn\n',
    });

    expect(result.exitCode).to.equal(0);
    expect(await fileExists(path.join(projectPath, 'antelope.json'))).to.be.true;

    const config = await readJson<{ name: string }>(path.join(projectPath, 'antelope.json'));
    expect(config.name).to.equal(projectName);
  });

  it('should create antelope.json with custom project name', async () => {
    const projectDir = 'project-dir';
    const customName = 'custom-project-name';
    const projectPath = path.join(testDir, projectDir);

    // Provide stdin input for inquirer prompts:
    // 1. Project name - provide custom name
    // 2. "Do you have an existing app module?" - answer "n" (no)
    // 3. "Would you like to create a new app module now?" - answer "n" (no)
    const result = await runCLI(['project', 'init', projectPath], {
      stdin: `${customName}\nn\nn\n`,
    });

    expect(result.exitCode).to.equal(0);
    expect(await fileExists(path.join(projectPath, 'antelope.json'))).to.be.true;

    const config = await readJson<{ name: string }>(path.join(projectPath, 'antelope.json'));
    expect(config.name).to.equal(customName);
  });

  it('should create project directory if it does not exist', async () => {
    const nestedPath = path.join(testDir, 'nested', 'deep', 'project');

    const result = await runCLI(['project', 'init', nestedPath], {
      stdin: '\nn\nn\n',
    });

    expect(result.exitCode).to.equal(0);
    expect(await fileExists(nestedPath)).to.be.true;
    expect(await fileExists(path.join(nestedPath, 'antelope.json'))).to.be.true;
  });

  it('should handle existing antelope.json gracefully', async () => {
    // Create existing project config
    const projectPath = path.join(testDir, 'existing-project');
    await fsp.mkdir(projectPath, { recursive: true });

    const existingConfig = { name: 'existing', modules: { 'existing-module': {} } };
    await fsp.writeFile(path.join(projectPath, 'antelope.json'), JSON.stringify(existingConfig, null, 2));

    const result = await runCLI(['project', 'init', projectPath], {
      stdin: '\nn\nn\n',
    });

    // Should fail with exit code 1 because project already exists
    expect(result.exitCode).to.equal(1);

    // Should display error message about existing project
    expect(result.stdout).to.include('already exists');

    // Original config should be unchanged
    const config = await readJson<{ name: string; modules: Record<string, unknown> }>(
      path.join(projectPath, 'antelope.json'),
    );
    expect(config.name).to.equal('existing');
    expect(config.modules).to.have.property('existing-module');
  });

  it('should use absolute path for project', async () => {
    const relativePath = 'relative-project';
    const projectPath = path.join(testDir, relativePath);

    // Use cwd option to change working directory
    const result = await runCLI(['project', 'init', relativePath], {
      cwd: testDir,
      stdin: '\nn\nn\n',
    });

    expect(result.exitCode).to.equal(0);
    expect(await fileExists(path.join(projectPath, 'antelope.json'))).to.be.true;
  });

  it('should show welcome message during project creation', async () => {
    const projectPath = path.join(testDir, 'welcome-project');

    const result = await runCLI(['project', 'init', projectPath], {
      stdin: '\nn\nn\n',
    });

    expect(result.exitCode).to.equal(0);
    // Should display welcome/info message during setup
    expect(result.stdout).to.include('Project');
  });

  it('should create antelope.json with proper structure', async () => {
    const projectPath = path.join(testDir, 'structure-test');

    const result = await runCLI(['project', 'init', projectPath], {
      stdin: '\nn\nn\n',
    });

    expect(result.exitCode).to.equal(0);

    const config = await readJson<{ name: string; modules?: Record<string, unknown> }>(
      path.join(projectPath, 'antelope.json'),
    );

    // Should have name property
    expect(config).to.have.property('name');
    expect(config.name).to.be.a('string');
  });

  it('should handle special characters in project name', async () => {
    const projectPath = path.join(testDir, 'special-project');
    const specialName = 'my-project_v1.0';

    const result = await runCLI(['project', 'init', projectPath], {
      stdin: `${specialName}\nn\nn\n`,
    });

    expect(result.exitCode).to.equal(0);

    const config = await readJson<{ name: string }>(path.join(projectPath, 'antelope.json'));
    expect(config.name).to.equal(specialName);
  });

  it('should show project path confirmation message', async () => {
    const projectPath = path.join(testDir, 'path-test');

    const result = await runCLI(['project', 'init', projectPath], {
      stdin: '\nn\nn\n',
    });

    expect(result.exitCode).to.equal(0);

    // Should show that project path was checked/available
    expect(result.stdout).to.include('Project path');
    expect(result.stdout).to.include('available');
  });
});
