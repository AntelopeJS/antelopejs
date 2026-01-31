import { internal } from '../interfaces/core/beta';

export interface ModuleFolderEntry {
  dir: string;
  id: string;
  interfaceDir: string;
}

export class ModuleTracker {
  add(entry: ModuleFolderEntry): void {
    internal.moduleByFolder.push(entry);
  }

  remove(id: string): void {
    const filtered = internal.moduleByFolder.filter((entry) => entry.id !== id);
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length, ...filtered);
  }

  clear(): void {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
  }
}
