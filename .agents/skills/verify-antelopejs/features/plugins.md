---
covers:
  - src/cli/plugin*.ts
  - src/cli/commands/plugins*.ts
  - src/cli/commands/update.ts
  - src/cli/global-package-manager.ts
  - src/cli/executable-lookup.ts
  - src/cli/version-check.ts
  - src/cli/core-version.ts
docs:
  - docs/5.cli/1.introduction.md
  - docs/5.cli/6.plugin-api.md
---

# Plugins

`ajs plugins` lists the official plugins and where they resolve from; `ajs <plugin>` delegates to the plugin's binary; `ajs update` updates a global install.

## Sub-features

- `plugins-not-installed`: empty path: with no plugin, `dms` is `not-installed` in JSON and text.
- `plugins-local`: a plugin package in `node_modules/.bin` is `compatible` and `local`; `ajs dms hello --flag` runs it with the arguments.
- `update-not-global`: error path: `ajs update` from a checkout refuses; `ajs update nope` fails.

## How to get to it (user POV)

- `ajs plugins --json`
- `ajs dms …`
- `ajs update`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" plugins [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/plugins/<journey>/`.

## Gotchas

- Installing a missing plugin and a real global `update` need the network and a global prefix; report them under Not verified when `plugin.ts` or `update.ts` changes.
- The update check is off (`AJS_NO_UPDATE_CHECK=1`); `version-check.ts` changes need a journey with it on, which is not mapped yet.
