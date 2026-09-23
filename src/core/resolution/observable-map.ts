/**
 * A `Map` that reports every mutation, so caches derived from its entries can
 * be invalidated whoever mutates it.
 */
export class ObservableMap<K, V> extends Map<K, V> {
  constructor(private readonly onChange: () => void) {
    super();
  }

  override set(key: K, value: V): this {
    super.set(key, value);
    this.onChange();
    return this;
  }

  override delete(key: K): boolean {
    const isDeleted = super.delete(key);
    if (isDeleted) {
      this.onChange();
    }
    return isDeleted;
  }

  override clear(): void {
    super.clear();
    this.onChange();
  }
}
