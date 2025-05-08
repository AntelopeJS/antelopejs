export function ResolveLater<T>(): [Promise<T>, (val: T | PromiseLike<T>) => void] {
  let resolve: unknown = null;
  const promise = new Promise<T>((_resolve) => {
    resolve = _resolve;
  });
  return [promise, <(val: T | PromiseLike<T>) => void>resolve];
}

export function Detour<T>(func: (val: T) => void): (val: T) => T {
  return (val: T) => {
    func(val);
    return val;
  };
}

export function CreateDetour<T>(func: (promise: Promise<T>) => void): (val: T) => T {
  const [promise, resolve] = ResolveLater<T>();
  func(promise);
  return Detour<T>(resolve);
}
