export function Detour<T extends (...args: any[]) => any>(
  fn: T,
  sideEffect: (...args: Parameters<T>) => void,
): T {
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- A fresh wrapper does not copy callable-object properties; narrowing the exported T return would break declarations (#227).
  return ((...args: Parameters<T>) => {
    sideEffect(...args);
    return fn(...args);
  }) as T;
}

export function CreateDetour<T extends (...args: any[]) => any>(
  fn: T,
): { fn: T; detour: (sideEffect: (...args: Parameters<T>) => void) => void } {
  let currentSideEffect: ((...args: Parameters<T>) => void) | undefined;

  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- A fresh wrapper does not copy callable-object properties; narrowing the exported T return would break declarations (#227).
  const wrapped = ((...args: Parameters<T>) => {
    currentSideEffect?.(...args);
    return fn(...args);
  }) as T;

  // oxlint-disable-next-line anti-slop/no-known-value-widening -- The exported object return and callback signature must remain identical; inference changes its declaration.
  return {
    fn: wrapped,
    detour: (sideEffect) => {
      currentSideEffect = sideEffect;
    },
  };
}
