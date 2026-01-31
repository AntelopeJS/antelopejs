import { expect } from 'chai';
import { Container, TOKENS } from '../../src/core/container';

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
});
