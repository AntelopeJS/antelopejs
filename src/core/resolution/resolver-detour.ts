import Module from 'module';
import { Resolver } from './resolver';

type ModuleResolver = (request: string, parent: any, isMain: boolean, options: any) => string;

export class ResolverDetour {
  private oldResolver?: ModuleResolver;

  constructor(private resolver: Resolver) {}

  attach(): void {
    if (!this.oldResolver) {
      this.oldResolver = (Module as any)._resolveFilename;
      (Module as any)._resolveFilename = (request: string, parent: any, isMain: boolean, options: any) => {
        const newRequest = this.resolver.resolve(request, parent) ?? request;
        return this.oldResolver!(newRequest, parent, isMain, options);
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
