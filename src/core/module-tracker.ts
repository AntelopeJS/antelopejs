import { internal } from "@antelopejs/interface-core/internal";

export interface ModuleFolderEntry {
  dir: string;
  id: string;
  isImplementor?: boolean;
}

export class ModuleTracker {
  private readonly entries = new Set<ModuleFolderEntry>();

  add(entry: ModuleFolderEntry): void {
    this.entries.add(entry);
    internal.moduleByFolder.push(entry);
  }

  clear(): void {
    const retained = internal.moduleByFolder.filter(
      (entry) => !this.entries.has(entry),
    );
    internal.moduleByFolder.splice(
      0,
      internal.moduleByFolder.length,
      ...retained,
    );
    this.entries.clear();
  }
}
