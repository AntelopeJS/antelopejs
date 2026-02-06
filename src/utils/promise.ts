export interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function Detour<T extends (...args: any[]) => any>(fn: T, sideEffect: (...args: Parameters<T>) => void): T {
  return ((...args: Parameters<T>) => {
    sideEffect(...args);
    return fn(...args);
  }) as T;
}

export function CreateDetour<T extends (...args: any[]) => any>(
  fn: T,
): { fn: T; detour: (sideEffect: (...args: Parameters<T>) => void) => void } {
  let currentSideEffect: ((...args: Parameters<T>) => void) | undefined;

  const wrapped = ((...args: Parameters<T>) => {
    currentSideEffect?.(...args);
    return fn(...args);
  }) as T;

  return {
    fn: wrapped,
    detour: (sideEffect) => {
      currentSideEffect = sideEffect;
    },
  };
}
