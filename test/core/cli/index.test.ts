import { expect } from 'chai';
import { createCLI } from '../../../src/core/cli';

function commandNames(cmd: any): string[] {
  return cmd.commands.map((c: any) => c.name()).sort();
}

describe('CLI Entry Point', () => {
  it('should create CLI program', () => {
    const program = createCLI('0.0.1');
    expect(program).to.have.property('name');
    expect(program).to.have.property('parse');
  });

  it('should register all commands', () => {
    const program = createCLI('0.0.1');
    expect(commandNames(program)).to.include.members(['config', 'module', 'project']);

    const project = program.commands.find((c: any) => c.name() === 'project');
    expect(project).to.be.ok;
    if (!project) throw new Error('project command missing');

    expect(commandNames(project)).to.include.members(['build', 'dev', 'init', 'logging', 'modules', 'run', 'start']);

    const modules = project.commands.find((c: any) => c.name() === 'modules');
    if (!modules) throw new Error('project modules command missing');
    expect(commandNames(modules)).to.include.members(['add', 'install', 'list', 'remove', 'update']);

    const logging = project.commands.find((c: any) => c.name() === 'logging');
    if (!logging) throw new Error('project logging command missing');
    expect(commandNames(logging)).to.include.members(['set', 'show']);

    const mod = program.commands.find((c: any) => c.name() === 'module');
    expect(mod).to.be.ok;
    if (!mod) throw new Error('module command missing');

    expect(commandNames(mod)).to.include.members(['exports', 'imports', 'init', 'test']);

    const imports = mod.commands.find((c: any) => c.name() === 'imports');
    if (!imports) throw new Error('module imports command missing');
    expect(commandNames(imports)).to.include.members(['add', 'install', 'list', 'remove', 'update']);

    const exportsCmd = mod.commands.find((c: any) => c.name() === 'exports');
    if (!exportsCmd) throw new Error('module exports command missing');
    expect(commandNames(exportsCmd)).to.include.members(['generate', 'set']);

    const config = program.commands.find((c: any) => c.name() === 'config');
    expect(config).to.be.ok;
    if (!config) throw new Error('config command missing');

    expect(commandNames(config)).to.include.members(['get', 'reset', 'set', 'show']);
  });
});
