export interface ModuleManagerLifecycle {
  constructAll(): Promise<void>;
  startAll(): void;
  destroyAll(): Promise<void>;
}

export interface TestContextOptions {
  moduleManager?: ModuleManagerLifecycle;
  setup?: () => void | Promise<void>;
  cleanup?: () => void | Promise<void>;
}

export class TestContext {
  private moduleManager?: ModuleManagerLifecycle;
  private setupFn?: () => void | Promise<void>;
  private cleanupFn?: () => void | Promise<void>;

  constructor(options: TestContextOptions) {
    this.moduleManager = options.moduleManager;
    this.setupFn = options.setup;
    this.cleanupFn = options.cleanup;
  }

  async setup(): Promise<void> {
    if (this.setupFn) {
      await this.setupFn();
      return;
    }

    if (this.moduleManager) {
      await this.moduleManager.constructAll();
      this.moduleManager.startAll();
    }
  }

  async cleanup(): Promise<void> {
    if (this.cleanupFn) {
      await this.cleanupFn();
      return;
    }

    if (this.moduleManager) {
      await this.moduleManager.destroyAll();
    }
  }
}
