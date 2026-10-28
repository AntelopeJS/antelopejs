export {};

declare module "module" {
  namespace Module {
    /**
     * Node's CommonJS filename resolver. Node reads it on every `require`, and
     * code may replace it to redirect resolution.
     */
    let _resolveFilename: (
      request: string,
      parent?: { filename?: string } | null,
      isMain?: boolean,
      options?: { paths?: string[] },
    ) => string;

    /**
     * Node's CommonJS loader. Node reads it on every `require`, and code may
     * replace it to intercept loading.
     */
    let _load: (
      request: string,
      parent?: { filename?: string } | null,
      isMain?: boolean,
    ) => ReturnType<NodeJS.Require>;

    /**
     * Node's registry of loaded CommonJS modules, keyed by filename. Node
     * exposes it to user code as `require.cache`, but a module that an ESM
     * `load` hook supplies receives a `require` without it, so only this
     * property is always present.
     */
    let _cache: Record<string, NodeModule>;

    /** The `node_modules` lookup folders Node searches from `from`, nearest first. */
    function _nodeModulePaths(from: string): string[];
  }
}
