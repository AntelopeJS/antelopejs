import { expect } from 'chai';
import { Resolver } from '../../../src/core/resolution/resolver';
import { PathMapper } from '../../../src/core/resolution/path-mapper';

const moduleA = {
  id: 'modA',
  manifest: {
    exportsPath: '/modA/interfaces',
    srcAliases: [{ alias: '@src', replace: '/modA/src' }],
    paths: [],
  },
} as any;

const moduleB = {
  id: 'modB',
  manifest: {
    exportsPath: '/modB/interfaces',
    srcAliases: [],
    paths: [],
  },
} as any;

const moduleScoped = {
  id: 'scope/modB',
  manifest: {
    exportsPath: '/modScoped/interfaces',
    srcAliases: [],
    paths: [],
  },
} as any;

describe('Resolver', () => {
  it('should resolve @ajs.local paths', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set('/modA', moduleA);

    const result = resolver.resolve('@ajs.local/core/beta', { filename: '/modA/src/index.js' } as any);

    expect(result).to.equal('/modA/interfaces/core/beta');
  });

  it('should resolve @ajs paths via associations', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set('/modA', moduleA);
    resolver.moduleAssociations.set('modA', new Map([['core@beta', moduleB]]));

    const result = resolver.resolve('@ajs/core/beta', { filename: '/modA/src/index.js' } as any);

    expect(result).to.equal('/modB/interfaces/core/beta');
  });

  it('throws when @ajs interface is not imported', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set('/modA', moduleA);
    resolver.moduleAssociations.set('modA', new Map());

    expect(() => resolver.resolve('@ajs/core/beta', { filename: '/modA/src/index.js' } as any)).to.throw(
      'un-imported interface',
    );
  });

  it('returns stub module path for unresolved @ajs interface when stubModulePath is set', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set('/modA', moduleA);
    resolver.moduleAssociations.set('modA', new Map());
    resolver.stubModulePath = '/stubs/stub-interface';

    const result = resolver.resolve('@ajs/core/beta', { filename: '/modA/src/index.js' } as any);

    expect(result).to.equal('/stubs/stub-interface');
  });

  it('still throws for unresolved @ajs interface when stubModulePath is not set', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set('/modA', moduleA);
    resolver.moduleAssociations.set('modA', new Map());

    expect(() => resolver.resolve('@ajs/core/beta', { filename: '/modA/src/index.js' } as any)).to.throw(
      'un-imported interface',
    );
  });

  it('should resolve @ajs.raw paths', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.modulesById.set('modB', moduleB);

    const result = resolver.resolve('@ajs.raw/modB/core@beta/extra', undefined);

    expect(result).to.equal('/modB/interfaces/core/beta/extra');
  });

  it('should resolve @ajs.raw paths without file suffix', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.modulesById.set('modB', moduleB);

    const result = resolver.resolve('@ajs.raw/modB/core@beta', undefined);

    expect(result).to.equal('/modB/interfaces/core/beta');
  });

  it('should resolve @ajs.raw paths when module id contains slash', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.modulesById.set('scope/modB', moduleScoped);

    const result = resolver.resolve('@ajs.raw/scope/modB/core@beta/extra', undefined);

    expect(result).to.equal('/modScoped/interfaces/core/beta/extra');
  });

  it('should resolve @ajs.raw paths without file suffix when module id contains slash', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.modulesById.set('scope/modB', moduleScoped);

    const result = resolver.resolve('@ajs.raw/scope/modB/core@beta', undefined);

    expect(result).to.equal('/modScoped/interfaces/core/beta');
  });

  it('returns undefined for invalid @ajs.raw request pattern', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.modulesById.set('modB', moduleB);

    const result = resolver.resolve('@ajs.raw/modB/corebeta/extra', undefined);

    expect(result).to.equal(undefined);
  });

  it('returns undefined when @ajs.raw module id is unknown', () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve('@ajs.raw/missing/core@beta/extra', undefined);

    expect(result).to.equal(undefined);
  });

  it('should resolve module aliases using PathMapper', () => {
    const mapper = new PathMapper(() => false);
    const resolver = new Resolver(mapper);
    resolver.moduleByFolder.set('/modA', moduleA);

    const result = resolver.resolve('@src/utils', { filename: '/modA/src/index.js' } as any);

    expect(result).to.equal('/modA/src/utils');
  });

  it('returns undefined for invalid @ajs request pattern', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set('/modA', moduleA);

    const result = resolver.resolve('@ajs/invalid', { filename: '/modA/src/index.js' } as any);

    expect(result).to.equal(undefined);
  });

  it('prefers the longest matching folder', () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set('/modA', moduleA);
    resolver.moduleByFolder.set('/mod', moduleB);
    resolver.moduleAssociations.set('modA', new Map([['core@beta', moduleB]]));

    const result = resolver.resolve('@ajs/core/beta', { filename: '/modA/src/index.js' } as any);

    expect(result).to.equal('/modB/interfaces/core/beta');
  });
});
