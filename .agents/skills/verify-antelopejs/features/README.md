# Feature map

One file per feature. `covers:` lists the source globs it owns, `docs:` the pages a verdict judges, and `seeded-breaks/<feature>.patch` the break its journeys must catch. `node .agents/skills/verify-antelopejs/bin/verify-ajs.mts map` checks that every `src/**` file is covered.

| Feature | What the user does | Journeys |
|---|---|---|
| [cli-shell](cli-shell.md) | The root of `ajs`: version, help, command routing, exit codes and the output flags shared by every command. | version-help, unknown-command, quiet-verbose |
| [config](config.md) | `ajs config show\|get\|set\|reset` reads and writes `~/.antelopejs/config.json`, shared by every project. | config-defaults, config-set-get, config-set-invalid, config-unknown-key, config-reset, config-base-file |
| [embedded-runtime](embedded-runtime.md) | `createRuntime` from `@antelopejs/core` lets a host application load modules and call interfaces without the CLI. | embedded-start-use-stop, embedded-missing-provider |
| [interface-resolution](interface-resolution.md) | Every interface package has one shared copy per project. A consumer's range must admit it, and a provider must implement it. | resolution-provider-consumer, resolution-range-conflict, resolution-range-union, resolution-missing-provider |
| [library-launch](library-launch.md) | `launch`, `build` and `launchFromBuild`, exported by `@antelopejs/core`, run a project from code. | launch-build-from-build |
| [module-init](module-init.md) | `ajs module init` creates a module from a template of the interface repository given by `--git`, `ANTELOPEJS_GIT` or the git setting. | module-init-flags, module-init-env-git, module-init-needs-input, module-init-occupied, module-init-unknown-template, module-init-bad-git |
| [module-test](module-test.md) | `ajs module test` loads and starts a module with the test configuration `antelopeJs.test` names, then runs its mocha tests. | module-test-pass, module-test-fail, module-test-file, module-test-file-docs-form, module-test-no-config |
| [plugins](plugins.md) | `ajs plugins` lists the official plugins and where they resolve from; `ajs <plugin>` delegates to the plugin's binary; `ajs update` updates a global install. | plugins-not-installed, plugins-local, update-not-global |
| [project-build](project-build.md) | `ajs project build` resolves the project's modules once and writes `.antelope/build/build.json`, which `ajs project start` and `launchFromBuild` read. | build-artifact, build-env, build-range-conflict, build-no-project |
| [project-dev](project-dev.md) | `ajs project dev` (alias `ajs project run`) installs and loads the project's modules and keeps them running. `--watch` reloads a module when its watched files change; a failed reload keeps the previous instance. | dev-call-stop, dev-hmr, dev-failed-reload, dev-run-alias, dev-project-flag, dev-cancel-during-start, dev-inspect, dev-no-project |
| [project-init](project-init.md) | `ajs project init` creates a project folder with `antelope.config.ts` and its first module from a template of the interface repository. Without a terminal it never prompts: a missing answer exits 2 and writes nothing. | init-flags, init-name-git, init-yes, init-needs-input, init-unknown-template, init-existing, init-cancel, init-unreachable-source |
| [project-logging](project-logging.md) | `ajs project logging show\|set` reads and changes the `logging` block of `antelope.config.ts`. | logging-show-defaults, logging-set-roundtrip, logging-set-usage-error, logging-set-needs-input |
| [project-modules](project-modules.md) | `ajs project modules add\|list\|remove\|install\|update` edits the modules of `antelope.config.ts` and downloads them. Every mutation is read back with `ajs project modules list --json`. | modules-list-empty, modules-add-remove-local, modules-add-keeps-config, modules-remove-unknown, modules-add-unreachable-package, modules-install, modules-install-range-conflict, modules-update-dry-run |
| [project-start](project-start.md) | `ajs project start` runs a project from its build artifact, without downloading modules. `--refresh-config` resolves the configuration again and exits 3 when the module set differs from the build. | start-from-build, start-without-build, start-refresh-config, start-refresh-config-changed, start-base-build |
| [smoke](smoke.md) | The fixed journey every verdict runs, whatever the diff touches: create a project from a template, run it, call its module over HTTP, stop it. | smoke |

The smoke journey (`init -> dev -> fixture call -> stop`) runs on every verdict.
