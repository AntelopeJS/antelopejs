import Module from "node:module";
import path from "node:path";
import type { Resolver } from "./resolver";

type ModuleResolver = (
  request: string,
  parent: any,
  isMain: boolean,
  options: any,
) => string;

export class ResolverDetour {
  private oldResolver?: ModuleResolver;

  constructor(private resolver: Resolver) {}

  attach(): void {
    if (!this.oldResolver) {
      this.oldResolver = (Module as any)._resolveFilename;
      (Module as any)._resolveFilename = (
        request: string,
        parent: any,
        isMain: boolean,
        options: any,
      ) => {
        const result = this.resolver.resolve(request, parent);
        if (!result) {
          return this.oldResolver?.(request, parent, isMain, options);
        }
        if (result.resolveFrom) {
          const contextParent = {
            ...parent,
            filename: path.join(result.resolveFrom, "_"),
          };
          return this.oldResolver?.(
            result.resolvedPath,
            contextParent,
            isMain,
            options,
          );
        }
        return this.oldResolver?.(result.resolvedPath, parent, isMain, options);
      };
    }
  }

  detach(): void {
    if (this.oldResolver) {
      (Module as any)._resolveFilename = this.oldResolver;
      this.oldResolver = undefined;
    }
  }
}
