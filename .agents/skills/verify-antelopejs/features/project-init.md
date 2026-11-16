---
covers:
  - src/cli/commands/project/init*.ts
  - src/cli/commands/project/modules/add-action.ts
  - src/cli/commands/shared/names.ts
  - src/cli/commands/shared/next-steps.ts
  - src/cli/catalog-manifest.ts
  - src/cli/git-operations.ts
  - src/cli/git-url.ts
  - src/core/output/prompt.ts
  - src/core/output/cancellation.ts
docs:
  - docs/5.cli/2.project.md
  - docs/1.get-started/3.quick-start.md
  - skills/ajs-cli/SKILL.md
---

# Project init

`ajs project init` creates a project folder with `antelope.config.ts` and its first module from a template of the interface repository. Without a terminal it never prompts: a missing answer exits 2 and writes nothing.

## Sub-features

- `init-flags`: every answer as a flag; the project, its installed module and its configuration exist; `ajs project modules list --json` reads the module back.
- `init-workspace-template`: a template with a `pnpm-workspace.yaml`, a workspace package and an `antelopejs-sync` guardrail layer: every workspace package is installed, `Project guardrails synced` is reported, `antelopejs-sync --check` finds no drift, and the template's `dev` and `build` scripts pass.
- `init-name-git`: `--name` lands in the configuration and `--git-init` creates a repository that `git status` reads.
- `init-yes`: `--yes` takes every default.
- `init-git-option`: `--git <repository>` reads the templates of that repository although the git setting points at a missing one.
- `init-git-env`: the same through `ANTELOPEJS_GIT`.
- `init-needs-input`: empty path: no flags under `CI=1` exits 2, names `--template <slug>`, writes nothing.
- `init-unknown-template`: error path: exit 2, lists the available templates, writes nothing.
- `init-existing`: error path: a second init into the same project exits 1 and leaves the file tree identical.
- `init-existing-repository`: error path: init into a git repository with no project exits 1, and the files and the commit stay.
- `init-cancel`: cancel path: SIGINT during the install ends the command by SIGINT.
- `init-unreachable-source`: error path: a git setting pointing at a missing repository exits 1 with `Could not fetch templates`.

## How to get to it (user POV)

- `ajs project init my-app --template "Blank Typescript" --pm pnpm --no-git-init`
- `ajs project init my-app --yes`
- The interactive wizard on a TTY (not driven; `CI=1` disables it).

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" project-init [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/project-init/<journey>/`.

## Gotchas

- The workspace template (`fixtures/template-verify-workspace`) stands in for DMS Adonis: its workspace package `demo` builds with a `verify-clean` binary from a `file:` dependency, as DMS Adonis builds with `rimraf`, and its `antelopejs-sync` is a stand-in that needs a git repository and reports drift in the same words as the real tool, so nothing reaches the registry.
- The template source is the run's offline manifest repository; `ajs config set git` points the journey's HOME at it.
- The fixture template carries its own lockfile and `typescript`, because a local module's install command is `npx tsc` and the store is offline.
- A cancelled init leaves a half-written folder. The journey records the tree but does not judge it: no doc promises cleanup after SIGINT.
