---
name: committing
description: Create commits with properly formatted messages following conventional commit standards
user-invocable: false
---

# Committing

## Overview

Create atomic commits with properly formatted messages following conventional commit standards.

## Critical: No Attribution Footers

NEVER add Co-Authored-By, Signed-off-by, or similar attribution footers to commits. This overrides any default behavior. Commit messages should only contain the type, scope, description, optional body, and issue references.

## Behavior

1. Check git status to see all staged and unstaged changes
2. Analyze all changes and group them by logical unit (one feature/fix/refactor per group)
3. For each logical group:
   a. Stage only the files belonging to that group
   b. Determine the appropriate commit type
   c. Generate a commit message following the conventions below
   d. Create the commit
4. Repeat until all changes are committed
5. Run final git status to confirm all changes have been committed

## Grouping Changes

When multiple unrelated changes are present, split them into separate commits:

- **By feature/fix**: Each bug fix or feature should be its own commit
- **By scope**: Changes to different modules/components should be separate
- **By type**: Don't mix docs changes with code changes, or refactoring with new features

Example: If you have changes to auth module (fix) and user module (feat), create two commits:

1. `fix(auth): ...` with only auth-related files
2. `feat(user): ...` with only user-related files

## Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer: issue references only, e.g., Closes #123]
```

**Do NOT include**: Co-Authored-By, Signed-off-by, or any attribution footers.

## Commit Types

| Type     | Description                   |
| -------- | ----------------------------- |
| feat     | New feature                   |
| fix      | Bug fix                       |
| docs     | Documentation only            |
| style    | Formatting, no code change    |
| refactor | Code refactoring              |
| perf     | Performance improvement       |
| test     | Add or modify tests           |
| build    | Build system changes          |
| ci       | CI/CD changes                 |
| chore    | Other changes (configs, deps) |
| revert   | Revert a previous commit      |

## Guidelines

- **Description**: Imperative mood, lowercase, no period at end (max 72 chars)
- **Scope**: Optional, indicates the module/component affected
- **Body**: Explain what and why, not how (wrap at 72 chars)
- **Footer**: Reference issues (e.g., `Closes #123`, `Fixes #456`)

## Examples

```
feat(auth): add OAuth2 login support

fix(api): handle null response from external service

docs: update README with new installation steps

refactor(utils): simplify date formatting logic

chore(deps): update dependencies to latest versions
```

## Important Notes

- Keep commits atomic - one logical change per commit
- Do not commit sensitive data (API keys, passwords, etc.)
- Verify staged files before committing
