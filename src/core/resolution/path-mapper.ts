import * as path from 'path';
import { ModuleManifest } from '../module-manifest';
import { accessSync, constants } from 'fs';

export type ExistsSync = (filePath: string) => boolean;

function defaultExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export class PathMapper {
  constructor(private exists: ExistsSync = defaultExists) {}

  resolve(request: string, manifest: ModuleManifest): string | undefined {
    if (manifest.srcAliases) {
      for (const { alias, replace } of manifest.srcAliases) {
        if (request.startsWith(alias)) {
          return request.length > alias.length ? path.join(replace, request.substring(alias.length)) : replace;
        }
      }
    }

    for (const entry of manifest.paths) {
      if (request.startsWith(entry.key)) {
        const part = request.substring(entry.key.length);
        for (const testPathPart of entry.values) {
          const testPath = path.join(testPathPart, part);
          if (this.exists(testPath + '.js') || this.exists(path.join(testPath, 'index.js'))) {
            return testPath;
          }
        }
      }
    }

    return undefined;
  }
}
