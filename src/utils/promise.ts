type Detoured<Args extends unknown[], Result> = (...args: Args) => Result;

export function Detour<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  sideEffect: (...args: Args) => void,
): Detoured<Args, Result> {
  return (...args: Args) => {
    sideEffect(...args);
    return fn(...args);
  };
}

export function CreateDetour<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
) {
  let currentSideEffect: ((...args: Args) => void) | undefined;

  const wrapped: Detoured<Args, Result> = (...args: Args) => {
    currentSideEffect?.(...args);
    return fn(...args);
  };

  return {
    fn: wrapped,
    detour: (sideEffect: (...args: Args) => void) => {
      currentSideEffect = sideEffect;
    },
  };
}
