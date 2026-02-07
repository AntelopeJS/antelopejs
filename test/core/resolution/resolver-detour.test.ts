import { expect } from 'chai';
import { ResolverDetour } from '../../../src/core/resolution/resolver-detour';
import { Resolver } from '../../../src/core/resolution/resolver';
import { PathMapper } from '../../../src/core/resolution/path-mapper';
import Module from 'module';

describe('ResolverDetour', () => {
  it('should attach and detach from Node resolver', () => {
    const original = (Module as any)._resolveFilename;
    let lastRequest = '';
    const stubResolver = (request: string) => {
      lastRequest = request;
      return request;
    };
    (Module as any)._resolveFilename = stubResolver;

    const resolver = new Resolver(new PathMapper(() => false));
    const detour = new ResolverDetour(resolver);

    detour.attach();
    const result = (Module as any)._resolveFilename('test', { filename: '/modA/src/index.js' }, false, {});

    expect(result).to.equal('test');
    expect(lastRequest).to.equal('test');

    detour.detach();
    expect((Module as any)._resolveFilename).to.equal(stubResolver);

    (Module as any)._resolveFilename = original;
  });
});
