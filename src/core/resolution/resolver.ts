import * as path from 'path';
import { ModuleManifest } from '../module-manifest';
import { PathMapper } from './path-mapper';

export interface ModuleRef {
  id: string;
  manifest: ModuleManifest;
}

const AJS_PREFIX = '@ajs/';
const AJS_LOCAL_PREFIX = '@ajs.local/';
const AJS_RAW_PREFIX = '@ajs.raw/';
const AJS_INTERFACE_REGEX = /^@ajs\/([^\/]+)\/([^\/]+)/;
const RAW_INTERFACE_SEGMENT_REGEX = /\/([^\/@]+)@([^\/]+)(\/.*)?$/;

interface RawRequestParts {
  moduleId: string;
  interfaceName: string;
  interfaceVersion: string;
  filePath: string;
}

function parseRawRequest(request: string): RawRequestParts | undefined {
  if (!request.startsWith(AJS_RAW_PREFIX)) {
    return undefined;
  }
  const payload = request.substring(AJS_RAW_PREFIX.length);
  const interfaceMatch = payload.match(RAW_INTERFACE_SEGMENT_REGEX);
  if (!interfaceMatch) {
    return undefined;
  }
  const [fullSegment, interfaceName, interfaceVersion, fileSuffix = ''] = interfaceMatch;
  const moduleId = payload.substring(0, payload.length - fullSegment.length);
  if (!moduleId) {
    return undefined;
  }
  const filePath = fileSuffix.startsWith('/') ? fileSuffix.substring(1) : fileSuffix;
  return { moduleId, interfaceName, interfaceVersion, filePath };
}

export class Resolver {
  public readonly moduleByFolder = new Map<string, ModuleRef>();
  public readonly moduleAssociations = new Map<string, Map<string, ModuleRef | null>>();
  public readonly modulesById = new Map<string, ModuleRef>();

  constructor(private pathMapper: PathMapper) {}

  resolve(request: string, parent?: { filename?: string }): string | undefined {
    const matchingModule = this.resolveLocalModule(parent?.filename);
    if (matchingModule) {
      const localPath = this.resolveLocalRequest(request, matchingModule);
      if (localPath) {
        return localPath;
      }
      const mapped = this.pathMapper.resolve(request, matchingModule.manifest);
      if (mapped) {
        return mapped;
      }
    }

    return this.resolveInterfaceModule(request);
  }

  private resolveLocalModule(fileName?: string): ModuleRef | undefined {
    if (!fileName) {
      return undefined;
    }
    let matchingFolder = '';
    let matchingModule: ModuleRef | undefined;
    for (const [folder, module] of this.moduleByFolder) {
      if (fileName.startsWith(folder) && folder.length > matchingFolder.length) {
        matchingFolder = folder;
        matchingModule = module;
      }
    }
    return matchingModule;
  }

  private resolveLocalRequest(request: string, matchingModule: ModuleRef): string | undefined {
    const manifest = matchingModule.manifest;
    if (request.startsWith(AJS_LOCAL_PREFIX)) {
      return path.join(manifest.exportsPath, request.substring(AJS_LOCAL_PREFIX.length));
    }
    if (!request.startsWith(AJS_PREFIX)) {
      return undefined;
    }
    const match = request.match(AJS_INTERFACE_REGEX);
    if (!match) {
      return undefined;
    }
    const [, name, version] = match;
    const associations = this.moduleAssociations.get(matchingModule.id);
    const target = associations?.get(`${name}@${version}`);
    if (!target) {
      throw new Error(`Module ${matchingModule.id} tried to use un-imported interface ${name}@${version}`);
    }
    return path.join(target.manifest.exportsPath, request.substring(AJS_PREFIX.length));
  }

  private resolveInterfaceModule(request: string): string | undefined {
    const rawRequest = parseRawRequest(request);
    if (!rawRequest) {
      return undefined;
    }
    const target = this.modulesById.get(rawRequest.moduleId);
    if (!target) {
      return undefined;
    }
    return path.join(
      target.manifest.exportsPath,
      rawRequest.interfaceName,
      rawRequest.interfaceVersion,
      rawRequest.filePath,
    );
  }
}
