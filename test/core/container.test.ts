import { expect } from 'chai';
import { Container, getDefaultContainer, setDefaultContainer } from '../../src/core/container';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register/resolve', () => {
    it('should register and resolve a factory', () => {
      container.register('test', () => ({ value: 42 }));
      const result = container.resolve<{ value: number }>('test');
      expect(result.value).to.equal(42);
    });

    it('should create new instance each time for register', () => {
      let counter = 0;
      container.register('test', () => ({ id: ++counter }));

      const a = container.resolve<{ id: number }>('test');
      const b = container.resolve<{ id: number }>('test');

      expect(a.id).to.equal(1);
      expect(b.id).to.equal(2);
    });

    it('should throw when resolving an unknown token', () => {
      expect(() => container.resolve('missing')).to.throw('No registration found for token');
    });
  });

  describe('registerSingleton', () => {
    it('should return same instance', () => {
      let counter = 0;
      container.registerSingleton('test', () => ({ id: ++counter }));

      const a = container.resolve<{ id: number }>('test');
      const b = container.resolve<{ id: number }>('test');

      expect(a.id).to.equal(1);
      expect(b.id).to.equal(1);
      expect(a).to.equal(b);
    });
  });

  describe('registerInstance', () => {
    it('should return the exact instance', () => {
      const instance = { value: 'test' };
      container.registerInstance('test', instance);

      const result = container.resolve('test');
      expect(result).to.equal(instance);
    });
  });

  describe('createScope', () => {
    it('should inherit parent registrations', () => {
      container.register('parent', () => 'parent-value');
      const child = container.createScope();

      expect(child.resolve('parent')).to.equal('parent-value');
    });

    it('should allow child to override', () => {
      container.register('test', () => 'parent');
      const child = container.createScope();
      child.register('test', () => 'child');

      expect(container.resolve('test')).to.equal('parent');
      expect(child.resolve('test')).to.equal('child');
    });
  });

  describe('has', () => {
    it('should report local and parent registrations', () => {
      const parent = new Container();
      parent.register('parent', () => 'parent-value');
      const child = parent.createScope();
      child.register('child', () => 'child-value');

      expect(child.has('child')).to.equal(true);
      expect(child.has('parent')).to.equal(true);
      expect(child.has('missing')).to.equal(false);
    });
  });

  describe('default container', () => {
    it('should return the same default container instance', () => {
      const first = getDefaultContainer();
      const second = getDefaultContainer();
      expect(first).to.equal(second);
    });

    it('should allow replacing the default container', () => {
      const custom = new Container();
      setDefaultContainer(custom);

      expect(getDefaultContainer()).to.equal(custom);
    });
  });
});
