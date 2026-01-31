import { Module } from './module';

export class ModuleRegistry {
  private modules = new Map<string, Module>();

  register(module: Module): void {
    this.modules.set(module.id, module);
  }

  get(id: string): Module | undefined {
    return this.modules.get(id);
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  list(): string[] {
    return [...this.modules.keys()];
  }

  remove(id: string): void {
    this.modules.delete(id);
  }

  entries(): IterableIterator<[string, Module]> {
    return this.modules.entries();
  }
}
