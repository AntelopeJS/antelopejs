export type ReloadHandler = (moduleId: string) => void | Promise<void>;

const DEFAULT_DEBOUNCE_MS = 500;

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
          await this.reload(id);
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
