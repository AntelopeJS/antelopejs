# Changelog

## v0.3.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v0.3.0...v0.3.1)

### 🩹 Fixes

- Verbose option on project run when using the inspect flag ([#51](https://github.com/AntelopeJS/antelopejs/pull/51))

### 💅 Refactors

- **cli:** Use hard links for package linking ([f06d064](https://github.com/AntelopeJS/antelopejs/commit/f06d064))

### 🏡 Chore

- Changelog ([f2b9eaf](https://github.com/AntelopeJS/antelopejs/commit/f2b9eaf))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))
- Antony Rizzitelli <upd4ting@gmail.com>

## v0.2.0...v0.3.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- Allow testing specific files ([4abe43c](https://github.com/AntelopeJS/antelopejs/commit/4abe43c))
- Add generate script to package.json and enhance ImplementInterface type definitions ([5cdb195](https://github.com/AntelopeJS/antelopejs/commit/5cdb195))
- Improved CLI UX, LIFO spinner, local install, and output modes ([#41](https://github.com/AntelopeJS/antelopejs/pull/41))
- Using changelogen instead of release-it to generate changelog ([#44](https://github.com/AntelopeJS/antelopejs/pull/44))
- **cli:** Create symlinks for interfaces ([b0f0e45](https://github.com/AntelopeJS/antelopejs/commit/b0f0e45))
- REPL ([#46](https://github.com/AntelopeJS/antelopejs/pull/46))
- Reworked channel system ([#47](https://github.com/AntelopeJS/antelopejs/pull/47))
- Warn when using GetResponsibleModule in asynchronous contexts ([#48](https://github.com/AntelopeJS/antelopejs/pull/48))

### 🩹 Fixes

- Cli no longer shows "undefined@version" modules when updating/installing dependencies ([465e105](https://github.com/AntelopeJS/antelopejs/commit/465e105))
- Added sync version of ImplementInterface ([7b1b0ee](https://github.com/AntelopeJS/antelopejs/commit/7b1b0ee))
- **cli:** Move verbose section typing inside logging interface ([1d06508](https://github.com/AntelopeJS/antelopejs/commit/1d06508))
- Don't require implementation function to be async ([ba23759](https://github.com/AntelopeJS/antelopejs/commit/ba23759))
- Modulenames ([#45](https://github.com/AntelopeJS/antelopejs/pull/45))
- Clear channelCache when reloading logging config ([6cb3cc4](https://github.com/AntelopeJS/antelopejs/commit/6cb3cc4))
- Dont attach the same handler multiple times on an event proxy ([2f0194c](https://github.com/AntelopeJS/antelopejs/commit/2f0194c))
- Set error exit code with cli errors ([#49](https://github.com/AntelopeJS/antelopejs/pull/49))
- **watcher:** Check if file still exists ([fe37b8e](https://github.com/AntelopeJS/antelopejs/commit/fe37b8e))
- Attempt at fixing edge cases where the git module source would not update ([#50](https://github.com/AntelopeJS/antelopejs/pull/50))

### 💅 Refactors

- **cli:** Module exports generate ([143b5e3](https://github.com/AntelopeJS/antelopejs/commit/143b5e3))

### 📦 Build

- Command 'build' that remove previous one before building ([#42](https://github.com/AntelopeJS/antelopejs/pull/42))
- Generate output folder ([9c864e3](https://github.com/AntelopeJS/antelopejs/commit/9c864e3))

### 🏡 Chore

- Update pull request template to include interface file generation check ([bb22e01](https://github.com/AntelopeJS/antelopejs/commit/bb22e01))
- **release:** V0.3.0 ([61af6ae](https://github.com/AntelopeJS/antelopejs/commit/61af6ae))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>
- Thomas ([@Thomasims](https://github.com/Thomasims))
- Thomasims <thomas@antelopejs.com>
- Glastis ([@Glastis](https://github.com/Glastis))
- Fabrice Cst <fabrice@altab.be>

## [0.2.0](https://github.com/AntelopeJS/antelopejs/compare/v0.1.1...v0.2.0) (2025-07-03)

### Features

- **cli:** process interfaces dependencies on `module imports add` ([3df8da4](https://github.com/AntelopeJS/antelopejs/commit/3df8da4eb1681cb84e71f944d27c7ed06c9360fc))
- **imports:** add install command to manage missing interfaces ([#31](https://github.com/AntelopeJS/antelopejs/issues/31)) ([9a8c328](https://github.com/AntelopeJS/antelopejs/commit/9a8c328d7485926f2d68d65f4e6cb1836f75658c))
- setup & cleanup in test project configs ([5db4d34](https://github.com/AntelopeJS/antelopejs/commit/5db4d34800d687c1763bc5fc9b2fd8e1f7aa8a68))
- warn user on outdated ajs ([#36](https://github.com/AntelopeJS/antelopejs/issues/36)) ([b163dde](https://github.com/AntelopeJS/antelopejs/commit/b163dde67b464443c0a270f6fa22211d68db2610))

### Bug Fixes

- **cli:** handle ExitPromptError gracefully in CLI error handling ([#25](https://github.com/AntelopeJS/antelopejs/issues/25)) ([559dd0e](https://github.com/AntelopeJS/antelopejs/commit/559dd0ed72c2fc2405aa2b83a4ed9cd29ba952a9))
- **modules:** add list command to modules CLI ([#26](https://github.com/AntelopeJS/antelopejs/issues/26)) ([592721b](https://github.com/AntelopeJS/antelopejs/commit/592721b0de65bc52a43903d38aa9c6113d110aa1))
- now absolute, relative and paths containing // should work with every command ([#34](https://github.com/AntelopeJS/antelopejs/issues/34)) ([90c9b0a](https://github.com/AntelopeJS/antelopejs/commit/90c9b0a239e40a970a9b75c0aaa1f9acb455b8fb))

### Reverts

- Revert "chore: use skip install for adding imports inside module initialization" ([7bfd954](https://github.com/AntelopeJS/antelopejs/commit/7bfd954cefb5cc41dd8bfcb1de1036e900856b77))

## [0.1.1](https://github.com/AntelopeJS/antelopejs/compare/v0.1.0...v0.1.1) (2025-05-30)

### Bug Fixes

- **loader:** don't git pull if repository set to commit ([e60bea3](https://github.com/AntelopeJS/antelopejs/commit/e60bea30f4db82e38213176a44072d5c216de4cd))
- **loader:** git fetch before checkout when updating git module ([863c890](https://github.com/AntelopeJS/antelopejs/commit/863c8902fcd2bde9d4d416d43a3494f995f2c815))

## [0.1.0](https://github.com/AntelopeJS/antelopejs/compare/v0.0.2...v0.1.0) (2025-05-29)

### Features

- add antelope.module.json file for module configuration and defaultConfig option ([a923f18](https://github.com/AntelopeJS/antelopejs/commit/a923f18d3a8ab960362b59448f1427b95b1977ea))
- add project modules list command ([#23](https://github.com/AntelopeJS/antelopejs/issues/23)) ([340c3e7](https://github.com/AntelopeJS/antelopejs/commit/340c3e7169f2c66432a43ed6da274c6bc5989962))
- add skip install option for module imports ([8e44b31](https://github.com/AntelopeJS/antelopejs/commit/8e44b3188ba8faeee7610858346acd6a95706ccf))
- adding a module from cli now downloads the module's sources and save it to the antelope cache ([#14](https://github.com/AntelopeJS/antelopejs/issues/14)) ([c8000a1](https://github.com/AntelopeJS/antelopejs/commit/c8000a12bf50763da5a0a77fd6a51a9b532e20d3))
- enhance module initialization with interface selection ([#7](https://github.com/AntelopeJS/antelopejs/issues/7)) ([df928d9](https://github.com/AntelopeJS/antelopejs/commit/df928d966ef4b3efb0c77dc0719c07b75202cad8))
- indentation type of config file is kept (tab/space) ([#11](https://github.com/AntelopeJS/antelopejs/issues/11)) ([2d9ea95](https://github.com/AntelopeJS/antelopejs/commit/2d9ea95df39a3b722191313a62303d0658abbd18))
- let source config specify a different entry point ([#16](https://github.com/AntelopeJS/antelopejs/issues/16)) ([fc2b172](https://github.com/AntelopeJS/antelopejs/commit/fc2b172282b01d8107b2c08b8f773646561c4e71))
- loading logging is now on one single refreshing line ([3ca9dca](https://github.com/AntelopeJS/antelopejs/commit/3ca9dcae3a80fa15d9aa583067d1db5cd2b65e8d))
- module init install package command ([57a4bae](https://github.com/AntelopeJS/antelopejs/commit/57a4baed9b5f73295261142f82c8fd2a259ea21a))

### Bug Fixes

- correct spelling of 'optional' in module import options ([a2d4e91](https://github.com/AntelopeJS/antelopejs/commit/a2d4e917e3c6e433d86f88ce2f3785e875dcbbeb))
- execute cmd reject with default to stdout ([aa4ded5](https://github.com/AntelopeJS/antelopejs/commit/aa4ded5c720a6e44693c73749617a6603e608114))
- handle module init errors during project init ([e6f8630](https://github.com/AntelopeJS/antelopejs/commit/e6f86309598f56110c70e9fd0fc29bf6b6366e81))
- inline logging ([#4](https://github.com/AntelopeJS/antelopejs/issues/4)) ([9a9a6b6](https://github.com/AntelopeJS/antelopejs/commit/9a9a6b6e39417dfc9c0b426e9050d1e46cdb241c))
- interface files install without version directory ([#22](https://github.com/AntelopeJS/antelopejs/issues/22)) ([0179148](https://github.com/AntelopeJS/antelopejs/commit/0179148b6333ed7d4097b3002557c9d182afdbc8))
- update output path for TypeScript declarations generation ([#10](https://github.com/AntelopeJS/antelopejs/issues/10)) ([025c5e8](https://github.com/AntelopeJS/antelopejs/commit/025c5e888081a91c9ff48087fef6e76ab3b2d213))
- use local package manager and default to npm ([#9](https://github.com/AntelopeJS/antelopejs/issues/9)) ([3b9c960](https://github.com/AntelopeJS/antelopejs/commit/3b9c960b6e447db31bec12513c37d58e468a911a))

### Performance Improvements

- optimize ajs project modules add/fix commands ([4ecd5fd](https://github.com/AntelopeJS/antelopejs/commit/4ecd5fdbf0daa60b793e3e03c8d155dec5907186))

## [0.0.2](https://github.com/AntelopeJS/antelopejs/compare/v0.0.1...v0.0.2) (2025-05-10)

### Bug Fixes

- add compilation command when adding local module to project ([43ccd79](https://github.com/AntelopeJS/antelopejs/commit/43ccd79348289a82492f5faf912e4537aed8e274))
- allow install template in non-empty directory ([f39feb3](https://github.com/AntelopeJS/antelopejs/commit/f39feb3f6babf9a52def52c2cd06f02d4fb88427))
- optional version in module add ([#1](https://github.com/AntelopeJS/antelopejs/issues/1)) ([3713d00](https://github.com/AntelopeJS/antelopejs/commit/3713d003eac0a549b7542d077a89cbf335570c8b))

## 0.0.1 (2025-05-08)
