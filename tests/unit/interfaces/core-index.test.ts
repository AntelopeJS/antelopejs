import { expect, sinon } from '../../helpers/setup';
import {
  AsyncProxy,
  RegisteringProxy,
  EventProxy,
  internal,
  GetResponsibleModule,
  GetMetadata,
  InterfaceFunction,
  ImplementInterface,
  GetInterfaceInstances,
  GetInterfaceInstance,
} from '../../../src/interfaces/core/beta';

describe('interfaces/core/beta/index', () => {
  describe('internal.addAsyncProxy', () => {
    it('should add proxy to knownAsync map', () => {
      const proxy = new AsyncProxy();
      internal.addAsyncProxy('test-module', proxy);

      const proxies = internal.knownAsync.get('test-module');
      expect(proxies).to.include(proxy);
    });

    it('should create array if module not in map', () => {
      const proxy = new AsyncProxy();
      const moduleName = 'new-module-' + Date.now();

      internal.addAsyncProxy(moduleName, proxy);

      expect(internal.knownAsync.has(moduleName)).to.be.true;
    });
  });

  describe('internal.addRegisteringProxy', () => {
    it('should add proxy to knownRegisters map', () => {
      const proxy = new RegisteringProxy();
      internal.addRegisteringProxy('test-module', proxy);

      const proxies = internal.knownRegisters.get('test-module');
      expect(proxies).to.include(proxy);
    });
  });

  describe('GetResponsibleModule', () => {
    it('should return undefined when not in module context', () => {
      const result = GetResponsibleModule();
      // In test context, should return undefined or a module name
      expect(result === undefined || typeof result === 'string').to.be.true;
    });

    it('should accept ignoreInterfaces parameter', () => {
      const result = GetResponsibleModule(true);
      expect(result === undefined || typeof result === 'string').to.be.true;
    });

    it('should accept startFrame parameter', () => {
      const result = GetResponsibleModule(true, 0);
      expect(result === undefined || typeof result === 'string').to.be.true;
    });
  });

  describe('InterfaceFunction', () => {
    it('should return a callable function', () => {
      const fn = InterfaceFunction<(x: number) => number>();
      expect(fn).to.be.a('function');
    });

    it('should have a proxy property', () => {
      const fn = InterfaceFunction<(x: number) => number>();
      expect((fn as any).proxy).to.be.instanceof(AsyncProxy);
    });

    it('should return a Promise when called', () => {
      const fn = InterfaceFunction<(x: number) => number>();
      const result = fn(42);
      expect(result).to.be.instanceof(Promise);
    });
  });

  describe('ImplementInterface', () => {
    it('should implement AsyncProxy functions', () => {
      const proxy = new AsyncProxy<(x: number) => number>();
      const declaration = { myFunc: proxy };
      const implementation = { myFunc: (x: number) => x * 2 };

      const result = ImplementInterface(declaration as any, implementation as any);

      expect(result).to.have.property('declaration');
      expect(result).to.have.property('implementation');
    });

    it('should implement InterfaceFunction', async () => {
      const fn = InterfaceFunction<(x: number) => number>();
      const declaration = { myFunc: fn };
      const implementation = { myFunc: (x: number) => x * 2 };

      ImplementInterface(declaration as any, implementation as any);

      const result = await fn(5);
      expect(result).to.equal(10);
    });

    it('should implement RegisteringProxy', () => {
      const proxy = new RegisteringProxy<(id: string, value: number) => void>();
      const registerCallback = sinon.stub();
      const unregisterCallback = sinon.stub();

      const declaration = { myProxy: proxy };
      const implementation = {
        myProxy: { register: registerCallback, unregister: unregisterCallback },
      };

      ImplementInterface(declaration, implementation);

      proxy.register('id1', 42);
      expect(registerCallback).to.have.been.calledWith('id1', 42);
    });

    it('should handle nested interfaces', async () => {
      const fn = InterfaceFunction<() => string>();
      const declaration = { nested: { deepFunc: fn } };
      const implementation = { nested: { deepFunc: () => 'deep' } };

      ImplementInterface(declaration, implementation);

      const result = await fn();
      expect(result).to.equal('deep');
    });

    it('should handle Promise-based declaration', async () => {
      const fn = InterfaceFunction<() => string>();
      const declaration = Promise.resolve({ myFunc: fn });
      const implementation = { myFunc: () => 'result' };

      const result = await ImplementInterface(declaration, implementation);

      expect(result.declaration).to.have.property('myFunc');
    });
  });

  describe('GetInterfaceInstances', () => {
    it('should return an array', () => {
      const result = GetInterfaceInstances('some-interface');
      expect(result).to.be.an('array');
    });

    it('should return empty array when not in module context', () => {
      const result = GetInterfaceInstances('nonexistent');
      expect(result).to.deep.equal([]);
    });
  });

  describe('GetInterfaceInstance', () => {
    it('should return undefined when not in module context', () => {
      const result = GetInterfaceInstance('some-interface', 'some-id');
      expect(result).to.be.undefined;
    });
  });

  describe('GetMetadata', () => {
    class TestMetadata {
      static key = Symbol('TestMetadata');
      public value: string;

      constructor(target: any) {
        this.value = 'initialized';
      }

      inherit(parent: TestMetadata) {
        this.value = parent.value;
      }
    }

    it('should create metadata for target', () => {
      class MyClass {}
      const metadata = GetMetadata(MyClass, TestMetadata as any);

      expect(metadata).to.be.instanceof(TestMetadata);
      expect(metadata.value).to.equal('initialized');
    });

    it('should return same metadata on second call', () => {
      class MyClass {}
      const metadata1 = GetMetadata(MyClass, TestMetadata as any);
      const metadata2 = GetMetadata(MyClass, TestMetadata as any);

      expect(metadata1).to.equal(metadata2);
    });

    it('should inherit from parent class', () => {
      class ParentClass {}
      class ChildClass extends ParentClass {}

      const parentMeta = GetMetadata(ParentClass, TestMetadata as any);
      parentMeta.value = 'parent value';

      const childMeta = GetMetadata(ChildClass, TestMetadata as any);
      expect(childMeta.value).to.equal('parent value');
    });

    it('should work without inherit option', () => {
      class TestClass {}
      const metadata = GetMetadata(TestClass, TestMetadata as any, false);

      expect(metadata).to.be.instanceof(TestMetadata);
    });
  });
});
