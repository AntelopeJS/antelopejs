import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isObject, isString } from "../utils";

const UNKNOWN_CORE_VERSION = "0.0.0";
const CORE_PACKAGE_JSON = join(__dirname, "../../package.json");

export const CORE_PACKAGE_NAME = "@antelopejs/core";

export function getCoreVersion(): string {
  try {
    const packageJson: unknown = JSON.parse(
      readFileSync(CORE_PACKAGE_JSON, "utf8"),
    );
    const version = isObject(packageJson) ? packageJson.version : undefined;
    return isString(version) ? version : UNKNOWN_CORE_VERSION;
  } catch {
    return UNKNOWN_CORE_VERSION;
  }
}
