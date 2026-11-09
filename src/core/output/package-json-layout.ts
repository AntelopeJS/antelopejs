/**
 * The top-level fields of a package.json in the order oxfmt sorts them, from
 * `sort_object_keys` in oxc-project/sort-package-json. oxfmt puts every field
 * missing from this list after all of them.
 */
const FIELD_ORDER = [
  "$schema",
  "name",
  "displayName",
  "version",
  "stableVersion",
  "gitHead",
  "private",
  "description",
  "categories",
  "keywords",
  "homepage",
  "bugs",
  "license",
  "author",
  "maintainers",
  "contributors",
  "repository",
  "funding",
  "donate",
  "sponsor",
  "qna",
  "publisher",
  "man",
  "style",
  "example",
  "examplestyle",
  "assets",
  "bin",
  "source",
  "directories",
  "workspaces",
  "binary",
  "files",
  "os",
  "cpu",
  "libc",
  "type",
  "sideEffects",
  "main",
  "module",
  "browser",
  "types",
  "typings",
  "typesVersions",
  "typeScriptVersion",
  "typesPublisherContentHash",
  "react-native",
  "svelte",
  "unpkg",
  "jsdelivr",
  "jsnext:main",
  "umd",
  "umd:main",
  "es5",
  "esm5",
  "fesm5",
  "es2015",
  "esm2015",
  "fesm2015",
  "es2020",
  "esm2020",
  "fesm2020",
  "esnext",
  "imports",
  "exports",
  "publishConfig",
  "scripts",
  "betterScripts",
  "wireit",
  "dependencies",
  "devDependencies",
  "dependenciesMeta",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies",
  "resolutions",
  "overrides",
  "husky",
  "simple-git-hooks",
  "vite-staged",
  "lint-staged",
  "nano-staged",
  "pre-commit",
  "commitlint",
  "l10n",
  "contributes",
  "activationEvents",
  "extensionPack",
  "extensionDependencies",
  "extensionKind",
  "icon",
  "badges",
  "galleryBanner",
  "preview",
  "markdown",
  "napi",
  "flat",
  "config",
  "nodemonConfig",
  "browserify",
  "babel",
  "browserslist",
  "xo",
  "prettier",
  "eslintConfig",
  "eslintIgnore",
  "standard",
  "npmpkgjsonlint",
  "npmPackageJsonLintConfig",
  "npmpackagejsonlint",
  "release",
  "auto-changelog",
  "remarkConfig",
  "stylelint",
  "typescript",
  "typedoc",
  "tshy",
  "tsdown",
  "size-limit",
  "ava",
  "jest",
  "jest-junit",
  "jest-stare",
  "mocha",
  "nyc",
  "c8",
  "tap",
  "tsd",
  "typeCoverage",
  "oclif",
  "languageName",
  "preferGlobal",
  "devEngines",
  "engines",
  "engineStrict",
  "volta",
  "packageManager",
  "pnpm",
] as const;

type PackageJsonField = (typeof FIELD_ORDER)[number];

const FIELD_RANKS: ReadonlyMap<string, number> = new Map(
  FIELD_ORDER.map((field, rank) => [field, rank]),
);

function fieldRank(field: string): number {
  return FIELD_RANKS.get(field) ?? FIELD_ORDER.length;
}

function withEntry<Value>(
  entries: Readonly<Record<string, Value>>,
  key: string,
  value: Value,
  sortsAfter: (existing: string) => boolean,
) {
  if (Object.hasOwn(entries, key)) {
    return { ...entries, [key]: value };
  }
  const ordered = Object.entries(entries);
  const index = ordered.findIndex(([existing]) => sortsAfter(existing));
  ordered.splice(index === -1 ? ordered.length : index, 0, [key, value]);
  return Object.fromEntries(ordered);
}

/**
 * The text of a package.json holding `manifest` with `field` set to `value`.
 * A field the manifest already has keeps its place; a new one goes where
 * oxfmt sorts it. The text has two-space indentation and a final newline, so
 * a formatted package.json stays formatted.
 */
export function packageJsonWith<Value>(
  manifest: Readonly<Record<string, Value>>,
  field: PackageJsonField,
  value: NoInfer<Value>,
): string {
  const rank = fieldRank(field);
  const updated = withEntry(
    manifest,
    field,
    value,
    (existing) => fieldRank(existing) > rank,
  );
  return `${JSON.stringify(updated, null, 2)}\n`;
}

/**
 * `dependencies` with `name` listed. A package already listed keeps its place
 * and its range, unless the range is null; a new one gets `range` and goes
 * where oxfmt sorts it, in alphabetical order.
 */
export function withDependency<Value>(
  dependencies: Readonly<Record<string, Value>>,
  name: string,
  range: string,
): Record<string, Value | string> {
  const listed = Object.hasOwn(dependencies, name)
    ? dependencies[name]
    : undefined;
  return withEntry<Value | string>(
    dependencies,
    name,
    listed ?? range,
    (existing) => existing > name,
  );
}
