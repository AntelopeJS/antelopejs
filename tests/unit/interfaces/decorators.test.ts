import { expect } from '../../helpers/setup';
import {
  Func,
  Class,
  MakeClassDecorator,
  MakePropertyDecorator,
  MakePropertyAndClassDecorator,
  MakeMethodDecorator,
  MakeMethodAndClassDecorator,
  MakeMethodAndPropertyDecorator,
  MakeMethodAndPropertyAndClassDecorator,
  MakeParameterDecorator,
} from '../../../src/interfaces/core/beta/decorators';

describe('interfaces/core/beta/decorators', () => {
  describe('types', () => {
    it('should export Func type', () => {
      const fn: Func<[number], string> = (x: number) => x.toString();
      expect(fn(42)).to.equal('42');
    });

    it('should export Class type', () => {
      const TestClass: Class<{ value: number }> = class {
        value = 42;
      };
      expect(new TestClass().value).to.equal(42);
    });
  });

  describe('MakeClassDecorator', () => {
    it('should create a class decorator factory', () => {
      const decorator = MakeClassDecorator((target, param: string) => {
        (target as any).decorated = param;
        return target;
      });

      expect(decorator).to.be.a('function');
    });

    it('should apply decorator to class', () => {
      const decorator = MakeClassDecorator((target, param: string) => {
        (target as any).decorated = param;
        return target;
      });

      @decorator('test-value')
      class TestClass {}

      expect((TestClass as any).decorated).to.equal('test-value');
    });
  });

  describe('MakePropertyDecorator', () => {
    it('should create a property decorator factory', () => {
      const decorator = MakePropertyDecorator((target, key, param: string) => {
        if (!target.constructor._props) {
          target.constructor._props = {};
        }
        target.constructor._props[key] = param;
      });

      expect(decorator).to.be.a('function');
    });

    it('should apply decorator to property', () => {
      const decorator = MakePropertyDecorator((target, key, param: string) => {
        if (!target.constructor._props) {
          target.constructor._props = {};
        }
        target.constructor._props[key] = param;
      });

      class TestClass {
        @decorator('prop-value')
        myProp: string = '';
      }

      expect((TestClass as any)._props?.myProp).to.equal('prop-value');
    });
  });

  describe('MakePropertyAndClassDecorator', () => {
    it('should create a decorator that works on both properties and classes', () => {
      const decorated: string[] = [];

      const decorator = MakePropertyAndClassDecorator((target, key, param: string) => {
        decorated.push(`${key ? String(key) : 'class'}:${param}`);
        return target;
      });

      @decorator('class-param')
      class TestClass {
        @decorator('prop-param')
        myProp: string = '';
      }

      expect(decorated).to.include('myProp:prop-param');
      expect(decorated).to.include('class:class-param');
    });
  });

  describe('MakeMethodDecorator', () => {
    it('should create a method decorator factory', () => {
      const decorator = MakeMethodDecorator((target, key, descriptor, param: string) => {
        if (!target.constructor._methods) {
          target.constructor._methods = {};
        }
        target.constructor._methods[key] = param;
      });

      expect(decorator).to.be.a('function');
    });

    it('should apply decorator to method', () => {
      const decorator = MakeMethodDecorator((target, key, descriptor, param: string) => {
        if (!target.constructor._methods) {
          target.constructor._methods = {};
        }
        target.constructor._methods[key] = param;
      });

      class TestClass {
        @decorator('method-value')
        myMethod() {}
      }

      expect((TestClass as any)._methods?.myMethod).to.equal('method-value');
    });
  });

  describe('MakeMethodAndClassDecorator', () => {
    it('should create a decorator that works on methods and classes', () => {
      const decorated: string[] = [];

      const decorator = MakeMethodAndClassDecorator((target, key, descriptor, param: string) => {
        decorated.push(`${key ? String(key) : 'class'}:${param}`);
        return descriptor || target;
      });

      @decorator('class-param')
      class TestClass {
        @decorator('method-param')
        myMethod() {}
      }

      expect(decorated).to.include('myMethod:method-param');
      expect(decorated).to.include('class:class-param');
    });
  });

  describe('MakeMethodAndPropertyDecorator', () => {
    it('should create a decorator that works on methods and properties', () => {
      const decorated: string[] = [];

      const decorator = MakeMethodAndPropertyDecorator((target, key, descriptor, param: string) => {
        decorated.push(`${String(key)}:${param}`);
      });

      class TestClass {
        @decorator('prop-param')
        myProp: string = '';

        @decorator('method-param')
        myMethod() {}
      }

      expect(decorated).to.include('myProp:prop-param');
      expect(decorated).to.include('myMethod:method-param');
    });
  });

  describe('MakeMethodAndPropertyAndClassDecorator', () => {
    it('should create a decorator that works on methods, properties, and classes', () => {
      const decorated: string[] = [];

      const decorator = MakeMethodAndPropertyAndClassDecorator((target, key, descriptor, param: string) => {
        decorated.push(`${key ? String(key) : 'class'}:${param}`);
        return descriptor || target;
      });

      @decorator('class-param')
      class TestClass {
        @decorator('prop-param')
        myProp: string = '';

        @decorator('method-param')
        myMethod() {}
      }

      expect(decorated).to.include('class:class-param');
      expect(decorated).to.include('myProp:prop-param');
      expect(decorated).to.include('myMethod:method-param');
    });
  });

  describe('MakeParameterDecorator', () => {
    it('should create a parameter decorator factory', () => {
      const decorator = MakeParameterDecorator((target, key, index, param: string) => {
        if (!target.constructor._params) {
          target.constructor._params = {};
        }
        target.constructor._params[`${String(key)}:${index}`] = param;
      });

      expect(decorator).to.be.a('function');
    });

    it('should apply decorator to parameter', () => {
      const decorator = MakeParameterDecorator((target, key, index, param: string) => {
        if (!target.constructor._params) {
          target.constructor._params = {};
        }
        target.constructor._params[`${String(key)}:${index}`] = param;
      });

      class TestClass {
        myMethod(@decorator('param-value') value: string) {}
      }

      expect((TestClass as any)._params?.['myMethod:0']).to.equal('param-value');
    });
  });
});
