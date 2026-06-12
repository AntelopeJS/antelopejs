import {
  DEV_REGISTRY_PATH,
  type DevServerEndpoint,
  GetRuntimeInfo,
  RegisterDevServer,
} from "@antelopejs/interface-core/runtime";
import { expect } from "chai";
import {
  DevRegistryStore,
  registerCoreRuntimeInterface,
} from "../../src/core/runtime/dev-server-registry";
import { ShutdownManager } from "../../src/core/shutdown";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";

interface ResettableProxy {
  onCall(callback: () => undefined, manualDetach?: boolean): void;
  detach(): void;
}

interface ProxiedInterfaceFunction {
  proxy: ResettableProxy;
}

function resetProxy(interfaceFunction: unknown): void {
  const { proxy } = interfaceFunction as ProxiedInterfaceFunction;
  proxy.onCall(() => undefined, true);
  proxy.detach();
}

const PROJECT_PATH = "/project";
const REGISTRY_PATH = `${PROJECT_PATH}/${DEV_REGISTRY_PATH}`;
const TEMP_REGISTRY_PATH = `${REGISTRY_PATH}.tmp`;
const OWNER_PID = 4242;
const STARTED_AT = new Date("2026-06-12T10:00:00.000Z");
const API_ENDPOINTS: DevServerEndpoint[] = [
  { protocol: "http", host: "localhost", port: 5011 },
];
const WS_ENDPOINTS: DevServerEndpoint[] = [
  { protocol: "ws", host: "localhost", port: 5012 },
];

function createStore(
  fs: InMemoryFileSystem,
  isPidAlive?: (pid: number) => boolean,
): DevRegistryStore {
  return new DevRegistryStore({
    projectPath: PROJECT_PATH,
    fs,
    pid: OWNER_PID,
    startedAt: STARTED_AT,
    isPidAlive,
  });
}

async function readRegistry(fs: InMemoryFileSystem): Promise<unknown> {
  return JSON.parse(await fs.readFileString(REGISTRY_PATH));
}

describe("core/runtime dev server registry", () => {
  describe("DevRegistryStore", () => {
    it("writes the registry atomically with pid and startedAt", async () => {
      const fs = new InMemoryFileSystem();
      const store = createStore(fs);

      await store.register("api", API_ENDPOINTS);

      expect(await readRegistry(fs)).to.deep.equal({
        pid: OWNER_PID,
        startedAt: STARTED_AT.toISOString(),
        servers: { api: { endpoints: API_ENDPOINTS } },
      });
      expect(await fs.exists(TEMP_REGISTRY_PATH)).to.equal(false);
    });

    it("merges servers across registrations", async () => {
      const fs = new InMemoryFileSystem();
      const store = createStore(fs);

      await store.register("api", API_ENDPOINTS);
      await store.register("ws", WS_ENDPOINTS);

      const registry = (await readRegistry(fs)) as {
        servers: Record<string, unknown>;
      };
      expect(registry.servers).to.deep.equal({
        api: { endpoints: API_ENDPOINTS },
        ws: { endpoints: WS_ENDPOINTS },
      });
    });

    it("cleanup removes the registry only after a registration", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(REGISTRY_PATH, "{}");
      const store = createStore(fs);

      await store.cleanup();
      expect(await fs.exists(REGISTRY_PATH)).to.equal(true);

      await store.register("api", API_ENDPOINTS);
      await store.cleanup();
      expect(await fs.exists(REGISTRY_PATH)).to.equal(false);
    });

    it("removes an orphan registry when the owning pid is dead", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        REGISTRY_PATH,
        JSON.stringify({ pid: 999, startedAt: "", servers: {} }),
      );
      const store = createStore(fs, () => false);

      await store.removeOrphanRegistry();

      expect(await fs.exists(REGISTRY_PATH)).to.equal(false);
    });

    it("keeps the registry when the owning pid is alive", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        REGISTRY_PATH,
        JSON.stringify({ pid: 999, startedAt: "", servers: {} }),
      );
      const store = createStore(fs, () => true);

      await store.removeOrphanRegistry();

      expect(await fs.exists(REGISTRY_PATH)).to.equal(true);
    });

    it("removes a corrupt registry file", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(REGISTRY_PATH, "not-json");
      const store = createStore(fs, () => true);

      await store.removeOrphanRegistry();

      expect(await fs.exists(REGISTRY_PATH)).to.equal(false);
    });
  });

  describe("registerCoreRuntimeInterface", () => {
    afterEach(() => {
      resetProxy(GetRuntimeInfo);
      resetProxy(RegisterDevServer);
    });

    it("exposes runtime info and writes the dev registry in dev mode", async () => {
      const fs = new InMemoryFileSystem();
      const shutdownManager = new ShutdownManager();

      await registerCoreRuntimeInterface({
        dev: true,
        projectPath: PROJECT_PATH,
        env: "default",
        fs,
        shutdownManager,
      });

      expect(await GetRuntimeInfo()).to.deep.equal({
        dev: true,
        projectPath: PROJECT_PATH,
        env: "default",
      });

      await RegisterDevServer("api", API_ENDPOINTS);
      const registry = (await readRegistry(fs)) as {
        pid: number;
        servers: Record<string, unknown>;
      };
      expect(registry.pid).to.equal(process.pid);
      expect(registry.servers).to.deep.equal({
        api: { endpoints: API_ENDPOINTS },
      });

      await shutdownManager.shutdown();
      expect(await fs.exists(REGISTRY_PATH)).to.equal(false);
    });

    it("removes an orphan registry left by a dead process at startup", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        REGISTRY_PATH,
        JSON.stringify({ pid: 999, startedAt: "", servers: {} }),
      );

      await registerCoreRuntimeInterface({
        dev: true,
        projectPath: PROJECT_PATH,
        env: "default",
        fs,
        isPidAlive: () => false,
      });

      expect(await fs.exists(REGISTRY_PATH)).to.equal(false);
    });

    it("keeps GetRuntimeInfo available but skips the registry outside dev mode", async () => {
      const fs = new InMemoryFileSystem();
      const shutdownManager = new ShutdownManager();

      await registerCoreRuntimeInterface({
        dev: false,
        projectPath: PROJECT_PATH,
        env: "production",
        fs,
        shutdownManager,
      });

      expect(await GetRuntimeInfo()).to.deep.equal({
        dev: false,
        projectPath: PROJECT_PATH,
        env: "production",
      });

      await RegisterDevServer("api", API_ENDPOINTS);
      expect(await fs.exists(REGISTRY_PATH)).to.equal(false);
    });
  });
});
