import { Logging } from "@antelopejs/interface-core/logging";

export type ReloadHandler = (moduleId: string) => void | Promise<void>;

const DEFAULT_DEBOUNCE_MS = 500;
const Logger = new Logging.Channel("loader.hot-reload");

export class HotReload {
  private pending = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(
    private reload: ReloadHandler,
    private debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  queue(moduleId: string): void {
    this.pending.add(moduleId);
    if (!this.timer) {
      this.timer = setTimeout(async () => {
        const modules = Array.from(this.pending);
        this.pending.clear();
        this.timer = undefined;
        for (const id of modules) {
          try {
            await this.reload(id);
          } catch (err) {
            Logger.Error(`Failed to reload module ${id}:`, err);
          }
        }
      }, this.debounceMs);
    }
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending.clear();
  }
}
