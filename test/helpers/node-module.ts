import Module from "node:module";

interface CommonJsHooks {
  _resolveFilename(
    request: string,
    parent?: { filename?: string } | null,
    isMain?: boolean,
    options?: { paths?: string[] },
  ): string;
  _load(
    request: string,
    parent?: { filename?: string } | null,
    isMain?: boolean,
  ): ReturnType<NodeJS.Require>;
}

// SAFETY: Node's CommonJS Module implements these hooks; ResolverDetour installs and restores these exact call signatures.
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- oxlint resolves the Node Module import as any (#229); tsc checks the constructor intersection.
export const nodeModule = Module as typeof Module & CommonJsHooks;
