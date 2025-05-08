/**
 * Represents a generic function type with arbitrary arguments and return type.
 *
 * @template A - Array type representing function parameters
 * @template R - Return type of the function
 */
export type Func<A extends any[] = any[], R = any> = (...args: A) => R;
/**
 * Represents a class constructor with arbitrary arguments.
 *
 * @template T - Type of the instance created by the constructor
 * @template A - Array type representing constructor parameters
 */
export type Class<T = any, A extends any[] = any[]> = {
    new (...args: A): T;
};
/**
 * Represents a class decorator that can be applied to a class constructor.
 *
 * @template C - The class constructor type this decorator can be applied to
 */
export type ClassDecorator<C = Class> = (t: C) => any;
/**
 * Represents a property decorator that can be applied to class properties.
 */
export type PropertyDecorator = (t: any, key: PropertyKey) => void;
/**
 * Represents a method decorator that can be applied to class methods or accessors.
 */
export type MethodDecorator = (t: any, key: PropertyKey, descriptor: PropertyDescriptor) => void;
/**
 * Represents a parameter decorator that can be applied to method parameters.
 */
export type ParameterDecorator = (t: any, key: PropertyKey, index: number) => void;
type MergeArray<A extends any[], B extends any[]> = A extends [infer P, ...infer PR] ? B extends [infer Q, ...infer QR] ? [P | Q, ...MergeArray<PR, QR>] : [P | undefined, ...MergeArray<PR, []>] : B extends [infer Q, ...infer QR] ? [Q | undefined, ...MergeArray<[], QR>] : [];
type UnwrapFunctions<T extends Func[]> = T extends [infer F] ? Parameters<F extends Func ? F : never> : T extends [infer F1, ...infer F2] ? MergeArray<Parameters<F1 extends Func ? F1 : never>, UnwrapFunctions<F2 extends Func[] ? F2 : never>> : [];
type Function1<T extends Func[], A extends any[], R = void, AR extends any[] = UnwrapFunctions<T>> = (a1: AR[0], ...args: A) => R;
type Function2<T extends Func[], A extends any[], R = void, AR extends any[] = UnwrapFunctions<T>> = (a1: AR[0], a2: AR[1], ...args: A) => R;
type Function3<T extends Func[], A extends any[], R = void, AR extends any[] = UnwrapFunctions<T>> = (a1: AR[0], a2: AR[1], a3: AR[2], ...args: A) => R;
/**
 * Creates a decorator factory that can be applied on classes.
 *
 * The callback arguments are split in two; the first for the decorator and the rest for the factory.
 * This allows for creating custom, parameterized class decorators with type safety.
 *
 * @template T - Array type representing factory parameters
 * @param handler - Decorator callback function that receives the target class and factory parameters
 * @returns Decorator factory function that accepts parameters and returns a class decorator
 */
export declare function MakeClassDecorator<T extends any[]>(handler: Function1<[ClassDecorator], T, any>): (...args: T) => ClassDecorator<Class<any, any[]>>;
/**
 * Creates a decorator factory that can be applied on properties.
 *
 * The callback arguments are split in two; the first 2 for the decorator and the rest for the factory.
 * This allows for creating custom, parameterized property decorators with type safety.
 *
 * @template T - Array type representing factory parameters
 * @param handler - Decorator callback function that receives the target object, property key, and factory parameters
 * @returns Decorator factory function that accepts parameters and returns a property decorator
 */
export declare function MakePropertyDecorator<T extends any[]>(handler: Function2<[PropertyDecorator], T, void>): (...args: T) => PropertyDecorator;
/**
 * Creates a decorator factory that can be applied on classes and properties.
 *
 * The callback arguments are split in two; the first 2 for the decorator and the rest for the factory.
 * This allows for creating custom, parameterized decorators that work on both classes and properties.
 *
 * @template T - Array type representing factory parameters
 * @param handler - Decorator callback function that receives the target (class or object), property key
 *                  (if applicable), and factory parameters
 * @returns Decorator factory function that accepts parameters and returns a class or property decorator
 */
export declare function MakePropertyAndClassDecorator<T extends any[]>(handler: Function2<[PropertyDecorator, ClassDecorator], T, any | undefined>): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator;
/**
 * Creates a decorator factory that can be applied on methods and accessors.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeMethodDecorator<T extends any[]>(handler: Function3<[MethodDecorator], T, void>): (...args: T) => MethodDecorator;
/**
 * Creates a decorator factory that can be applied on classes, methods, and accessors.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeMethodAndClassDecorator<T extends any[]>(handler: Function3<[MethodDecorator, ClassDecorator], T, any | undefined>): (...args: T) => ClassDecorator<Class<any, any[]>> & MethodDecorator;
/**
 * Creates a decorator factory that can be applied on properties, methods, and accessors.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeMethodAndPropertyDecorator<T extends any[]>(handler: Function3<[MethodDecorator, PropertyDecorator], T, void>): (...args: T) => PropertyDecorator & MethodDecorator;
/**
 * Creates a decorator factory that can be applied on classes, properties, methods, and accessors.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeMethodAndPropertyAndClassDecorator<T extends any[]>(handler: Function3<[MethodDecorator, PropertyDecorator, ClassDecorator], T, any | undefined>): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator & MethodDecorator;
/**
 * Creates a decorator factory that can be applied on parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterDecorator<T extends any[]>(handler: Function3<[ParameterDecorator], T, void>): (...args: T) => ParameterDecorator;
/**
 * Creates a decorator factory that can be applied on classes and parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterAndClassDecorator<T extends any[]>(handler: Function3<[ParameterDecorator, ClassDecorator], T, any | undefined>): (...args: T) => ClassDecorator<Class<any, any[]>> & ParameterDecorator;
/**
 * Creates a decorator factory that can be applied on properties and parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterAndPropertyDecorator<T extends any[]>(handler: Function3<[ParameterDecorator, PropertyDecorator], T, void>): (...args: T) => PropertyDecorator & ParameterDecorator;
/**
 * Creates a decorator factory that can be applied on classes, properties, and parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterAndPropertyAndClassDecorator<T extends any[]>(handler: Function3<[ParameterDecorator, PropertyDecorator, ClassDecorator], T, any | undefined>): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator & ParameterDecorator;
/**
 * Creates a decorator factory that can be applied on methods, accessors, and parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterAndMethodDecorator<T extends any[]>(handler: Function3<[ParameterDecorator, MethodDecorator], T, void>): (...args: T) => MethodDecorator & ParameterDecorator;
/**
 * Creates a decorator factory that can be applied on classes, methods, accessors, and parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterAndMethodAndClassDecorator<T extends any[]>(handler: Function3<[ParameterDecorator, MethodDecorator, ClassDecorator], T, any | undefined>): (...args: T) => ClassDecorator<Class<any, any[]>> & MethodDecorator & ParameterDecorator;
/**
 * Creates a decorator factory that can be applied on properties, methods, accessors, and parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterAndMethodAndPropertyDecorator<T extends any[]>(handler: Function3<[ParameterDecorator, MethodDecorator, PropertyDecorator], T, void>): (...args: T) => PropertyDecorator & MethodDecorator & ParameterDecorator;
/**
 * Creates a decorator factory that can be applied on classes, properties, methods, accessors, and parameters.
 *
 * The callback arguments are split in two; the first 3 for the decorator and the rest for the factory.
 *
 * @param handler Decorator callback
 * @returns Decorator factory
 */
export declare function MakeParameterAndMethodAndPropertyAndClassDecorator<T extends any[]>(handler: Function3<[ParameterDecorator, MethodDecorator, PropertyDecorator, ClassDecorator], T, any | undefined>): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator & MethodDecorator & ParameterDecorator;
export {};
