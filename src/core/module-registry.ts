import { Module } from './module';

export class ModuleRegistry {
  private modules = new Map<string, Module>();

  register(module: Module): void {
    this.modules.set(module.id, module);
  }

  get(id: string): Module | undefined {
    return this.modules.get(id);
  }

  list(): string[] {
    return [...this.modules.keys()];
  }
}
