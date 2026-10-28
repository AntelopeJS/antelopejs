---
covers:
  - src/cli/commands/project/init*.ts
  - src/cli/commands/shared/names.ts
  - src/cli/commands/shared/next-steps.ts
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
- `init-name-git`: `--name` lands in the configuration and `--git-init` creates a repository that `git status` reads.
- `init-yes`: `--yes` takes every default.
- `init-needs-input`: empty path: no flags under `CI=1` exits 2, names `--template <name>`, writes nothing.
- `init-unknown-template`: error path: exit 2, lists the available templates, writes nothing.
- `init-existing`: error path: a second init into the same project exits 1 and leaves the file tree identical.
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

- The template source is the run's offline manifest repository; `ajs config set git` points the journey's HOME at it.
- The fixture template carries its own lockfile and `typescript`, because a local module's install command is `npx tsc` and the store is offline.
- A cancelled init leaves a half-written folder. The journey records the tree but does not judge it: no doc promises cleanup after SIGINT.
