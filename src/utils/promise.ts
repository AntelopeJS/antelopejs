type Detoured<T extends (...args: any[]) => any> = (
  ...args: Parameters<T>
) => ReturnType<T>;

export function Detour<T extends (...args: any[]) => any>(
  fn: T,
  sideEffect: (...args: Parameters<T>) => void,
): Detoured<T> {
  return (...args: Parameters<T>) => {
    sideEffect(...args);
    return fn(...args);
  };
}

export function CreateDetour<T extends (...args: any[]) => any>(fn: T) {
  let currentSideEffect: ((...args: Parameters<T>) => void) | undefined;

  const wrapped: Detoured<T> = (...args: Parameters<T>) => {
    currentSideEffect?.(...args);
    return fn(...args);
  };

  return {
    fn: wrapped,
    detour: (sideEffect: (...args: Parameters<T>) => void) => {
      currentSideEffect = sideEffect;
    },
  };
}
