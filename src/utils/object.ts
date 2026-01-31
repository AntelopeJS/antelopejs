export function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

export function mergeDeep(
  target: Record<string, any>,
  ...sources: Array<Record<string, any> | undefined>
): Record<string, any> {
  let result: Record<string, any> = { ...target };

  for (const source of sources) {
    if (!source) continue;
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (isObject(sourceValue) && isObject(targetValue)) {
          result[key] = mergeDeep(targetValue, sourceValue as any);
        } else {
          result[key] = sourceValue as any;
        }
      }
    }
  }

  return result;
}

export function get(obj: Record<string, any>, path: string): unknown {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

export function set(obj: Record<string, any>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || !isObject(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}
