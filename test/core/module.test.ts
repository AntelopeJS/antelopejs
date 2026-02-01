import { expect } from 'chai';
import sinon from 'sinon';
import { Module } from '../../src/core/module';
import { AsyncProxy } from '../../src/interfaces/core/beta';

const manifest = {
  name: 'mod',
  version: '1.0.0',
  main: '/mod/index.js',
} as any;

describe('Module', () => {
  it('should load and run lifecycle callbacks', async () => {
    const callbacks = {
      construct: sinon.spy(),
      start: sinon.spy(),
      stop: sinon.spy(),
      destroy: sinon.spy(),
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({ foo: 'bar' });
    mod.start();
    mod.stop();
    await mod.destroy();

    expect(loader.calledOnce).to.be.true;
    expect(callbacks.construct.calledOnce).to.be.true;
    expect(callbacks.start.calledOnce).to.be.true;
    expect(callbacks.stop.calledOnce).to.be.true;
    expect(callbacks.destroy.calledOnce).to.be.true;
  });

  it('should detach proxies on destroy', async () => {
    const loader = sinon.stub().resolves({});
    const mod = new Module(manifest, loader);

    await mod.construct({});

    const proxy = new AsyncProxy();
    const detachSpy = sinon.spy(proxy, 'detach');
    mod.attachProxy(proxy);

    await mod.destroy();

    expect(detachSpy.calledOnce).to.be.true;
  });

  it('should not reload callbacks when already constructed', async () => {
    const loader = sinon.stub().resolves({});
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.construct({});

    expect(loader.calledOnce).to.equal(true);
  });

  it('should reload manifest and update version', async () => {
    const reloadManifest = {
      ...manifest,
      version: '1.0.0',
      reload: sinon.stub(),
    } as any;
    reloadManifest.reload.callsFake(async () => {
      reloadManifest.version = '1.0.1';
    });

    const loader = sinon.stub().resolves({});
    const mod = new Module(reloadManifest, loader);

    await mod.reload();

    expect(reloadManifest.reload.calledOnce).to.equal(true);
    expect(mod.version).to.equal('1.0.1');
  });
});
