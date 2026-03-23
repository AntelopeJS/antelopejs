import { internal } from "@antelopejs/interface-core/internal";

export interface ModuleFolderEntry {
  dir: string;
  id: string;
}

export class ModuleTracker {
  add(entry: ModuleFolderEntry): void {
    internal.moduleByFolder.push(entry);
  }

  clear(): void {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
  }
}
