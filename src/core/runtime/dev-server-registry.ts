import path from "node:path";
import * as coreInterfaceBeta from "@antelopejs/interface-core";
import type {
  DevServerEndpoint,
  DevServerEntry,
  DevServerRegistry,
  RuntimeInfo,
} from "@antelopejs/interface-core/runtime";
import * as runtimeInterfaceBeta from "@antelopejs/interface-core/runtime";
import type { IFileSystem } from "../../types";
import type { ShutdownManager } from "../shutdown";

const TEMP_FILE_SUFFIX = ".tmp";
const JSON_INDENT = 2;
const SHUTDOWN_PRIORITY_DEV_REGISTRY = 10;
const PERMISSION_DENIED_CODE = "EPERM";

export type PidProbe = (pid: number) => boolean;

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === PERMISSION_DENIED_CODE;
  }
}

export interface DevRegistryStoreOptions {
  projectPath: string;
  fs: IFileSystem;
  pid: number;
  startedAt: Date;
  isPidAlive?: PidProbe;
}

export class DevRegistryStore {
  private servers: Record<string, DevServerEntry> = {};
  private hasRegisteredServers = false;

  constructor(private options: DevRegistryStoreOptions) {}

  get registryFilePath(): string {
    return path.join(
      this.options.projectPath,
      runtimeInterfaceBeta.DEV_REGISTRY_PATH,
    );
  }

  async removeOrphanRegistry(): Promise<void> {
    if (!(await this.options.fs.exists(this.registryFilePath))) {
      return;
    }

    const existing = await this.readRegistry();
    if (existing && this.isOwnerAlive(existing)) {
      return;
    }

    await this.options.fs.rm(this.registryFilePath, { force: true });
  }

  async register(name: string, endpoints: DevServerEndpoint[]): Promise<void> {
    this.servers[name] = { endpoints };
    this.hasRegisteredServers = true;
    await this.writeRegistry();
  }

  async cleanup(): Promise<void> {
    if (!this.hasRegisteredServers) {
      return;
    }

    await this.options.fs.rm(this.registryFilePath, { force: true });
  }

  private isOwnerAlive(registry: DevServerRegistry): boolean {
    const probe = this.options.isPidAlive ?? isProcessAlive;
    return typeof registry.pid === "number" && probe(registry.pid);
  }

  private async readRegistry(): Promise<DevServerRegistry | undefined> {
    try {
      const content = await this.options.fs.readFileString(
        this.registryFilePath,
      );
      return JSON.parse(content) as DevServerRegistry;
    } catch {
      return undefined;
    }
  }

  private buildRegistry(): DevServerRegistry {
    return {
      pid: this.options.pid,
      startedAt: this.options.startedAt.toISOString(),
      servers: this.servers,
    };
  }

  private async writeRegistry(): Promise<void> {
    const filePath = this.registryFilePath;
    const tempPath = `${filePath}${TEMP_FILE_SUFFIX}`;
    await this.options.fs.mkdir(path.dirname(filePath), { recursive: true });
    await this.options.fs.writeFile(
      tempPath,
      `${JSON.stringify(this.buildRegistry(), null, JSON_INDENT)}\n`,
    );
    await this.options.fs.rename(tempPath, filePath);
  }
}

export interface RuntimeInterfaceOptions {
  dev: boolean;
  projectPath: string;
  env: string;
  fs: IFileSystem;
  shutdownManager?: ShutdownManager;
  isPidAlive?: PidProbe;
}

async function setupDevRegistryStore(
  options: RuntimeInterfaceOptions,
  projectPath: string,
): Promise<DevRegistryStore | undefined> {
  if (!options.dev) {
    return undefined;
  }

  const store = new DevRegistryStore({
    projectPath,
    fs: options.fs,
    pid: process.pid,
    startedAt: new Date(),
    isPidAlive: options.isPidAlive,
  });
  await store.removeOrphanRegistry();
  options.shutdownManager?.register(
    () => store.cleanup(),
    SHUTDOWN_PRIORITY_DEV_REGISTRY,
  );
  return store;
}

export async function registerCoreRuntimeInterface(
  options: RuntimeInterfaceOptions,
): Promise<void> {
  const projectPath = path.resolve(options.projectPath);
  const runtimeInfo: RuntimeInfo = {
    dev: options.dev,
    projectPath,
    env: options.env,
  };
  const store = await setupDevRegistryStore(options, projectPath);

  void coreInterfaceBeta.ImplementInterface(runtimeInterfaceBeta, {
    GetRuntimeInfo: async () => runtimeInfo,
    RegisterDevServer: async (name: string, endpoints: DevServerEndpoint[]) => {
      await store?.register(name, endpoints);
    },
  });
}
