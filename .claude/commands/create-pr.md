---
description: Commit changes and submit a PR
---

# Create Pull Request Command

Commit changes and submit a pull request on the current branch.

## Behavior

1. **REQUIRED SKILL:** Use committing to create commits following conventional commit standards
2. Push to remote
3. Create pull request:
   - **Check for PR template** in the repository (`.github/PULL_REQUEST_TEMPLATE.md` or similar) and use it if present
   - Otherwise, use the default format below

## PR Description Format (default)

The PR should include:
- **Summary**: Brief description of changes (bullet points)
- **Test plan**: How to verify the changes work correctly (only if tests were added or modified, otherwise omit or mark as N/A)
