export enum ModuleState {
  Loaded = 'loaded',
  Constructed = 'constructed',
  Active = 'active',
}

export interface ModuleCallbacks {
  construct?(config: unknown): Promise<void> | void;
  destroy?(): Promise<void> | void;
  start?(): void;
  stop?(): Promise<void> | void;
}

export interface ModuleSource {
  type: 'local' | 'git' | 'package' | 'local-folder';
  id?: string;
  ignoreCache?: boolean;
}

export interface ModuleSourceLocal extends ModuleSource {
  type: 'local';
  path: string;
  main?: string;
  watchDir?: string | string[];
  installCommand?: string | string[];
}

export interface ModuleSourceGit extends ModuleSource {
  type: 'git';
  remote: string;
  branch?: string;
  commit?: string;
  installCommand?: string | string[];
}

export interface ModuleSourcePackage extends ModuleSource {
  type: 'package';
  package: string;
  version: string;
}

export interface ModuleSourceLocalFolder extends ModuleSource {
  type: 'local-folder';
  path: string;
}
