import { strict as assert } from 'assert';
import { spawn } from 'child_process';
import { join } from 'path';

describe('AntelopeJS CLI - Basic Tests', () => {
  const cliPath = join(__dirname, '../../cli/index.js');

  describe('Main CLI', () => {
    it('should display help when --help flag is used', (done) => {
      const child = spawn('node', [cliPath, '--help'], {
        stdio: 'pipe',
      });

      let output = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          console.log('CLI Path:', cliPath);
          console.log('Exit code:', code);
          console.log('Stderr:', stderr);
          console.log('Stdout:', output);
        }
        assert.equal(code, 0);
        assert(output.includes('AntelopeJS CLI'));
        assert(output.includes('project'));
        assert(output.includes('module'));
        assert(output.includes('config'));
        done();
      });
    });

    it('should display version with --version flag', (done) => {
      const child = spawn('node', [cliPath, '--version'], {
        stdio: 'pipe',
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        assert.equal(code, 0);
        assert(output.match(/\d+\.\d+\.\d+/)); // Version pattern
        done();
      });
    });

    it('should handle invalid commands gracefully', (done) => {
      const child = spawn('node', [cliPath, 'invalid-command'], {
        stdio: 'pipe',
      });

      child.on('close', (code) => {
        assert.notEqual(code, 0);
        done();
      });
    });
  });

  describe('Project Commands', () => {
    it('should display project help', (done) => {
      const child = spawn('node', [cliPath, 'project', '--help'], {
        stdio: 'pipe',
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        assert.equal(code, 0);
        assert(output.includes('project'));
        done();
      });
    });
  });

  describe('Module Commands', () => {
    it('should display module help', (done) => {
      const child = spawn('node', [cliPath, 'module', '--help'], {
        stdio: 'pipe',
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        assert.equal(code, 0);
        assert(output.includes('module'));
        done();
      });
    });
  });

  describe('Config Commands', () => {
    it('should display config help', (done) => {
      const child = spawn('node', [cliPath, 'config', '--help'], {
        stdio: 'pipe',
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        assert.equal(code, 0);
        assert(output.includes('config'));
        done();
      });
    });
  });
});
