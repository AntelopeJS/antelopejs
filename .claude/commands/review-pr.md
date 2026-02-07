---
description: Review a GitHub PR with code-review-excellence skill
---

# Review PR Command

Review a GitHub Pull Request with detailed analysis and optional direct posting to GitHub.

## Arguments

- `{pr_url}`: GitHub PR URL (required)
  - Format: `https://github.com/{owner}/{repo}/pull/{pr_number}[/files|/commits]`

## Behavior

### Step 1: Parse PR URL

Extract from the provided URL:

- `owner`: Repository owner
- `repo`: Repository name
- `pr_number`: Pull request number

Supported URL formats:

- `https://github.com/owner/repo/pull/123`
- `https://github.com/owner/repo/pull/123/files`
- `https://github.com/owner/repo/pull/123/commits`

If no URL is provided, ask the user for it.

### Step 2: Fetch PR Data

Run these commands to get PR information:

```bash
# Get PR metadata
gh pr view {pr_number} --repo {owner}/{repo} --json title,author,baseRefName,headRefOid,body,files

# Get the diff
gh pr diff {pr_number} --repo {owner}/{repo}
```

Store the `headRefOid` (commit SHA) for generating code links.

### Step 3: Perform the Review

**REQUIRED SKILL:** Use the `code-review-excellence` skill to analyze the code changes.

Generate a review with:

- Overall assessment (APPROVE / REQUEST_CHANGES / COMMENT)
- Summary of changes (2-3 sentences)
- Categorized findings with file locations and line numbers

**Link format for code references:**

```
https://github.com/{owner}/{repo}/blob/{headRefOid}/{file_path}#L{line_number}
```

### Step 4: Present Review and Refine

Present the review to the user in this format:

```markdown
## PR Review: {title}

**Overall Assessment:** APPROVE / REQUEST_CHANGES / COMMENT

### Summary

{2-3 sentence summary of what the PR does and overall code quality}

### Blocking Issues

- [{file}:{line}]({link}) - {description}
  **Suggestion:** {how to fix}

### Important Issues

- [{file}:{line}]({link}) - {description}

### Suggestions

- [{file}:{line}]({link}) - {improvement suggestion}

### Highlights

- [{file}:{line}]({link}) - {what was done well}
```

After presenting, ask the user:

- **Refine**: Adjust the review based on feedback (loop back to refinement)
- **Approve**: Proceed to output options

### Step 5: Output Options

Always ask the user how they want to use the review:

**Option A - Copy-paste format (Recommended)**
Provide the review formatted as markdown that can be copied directly to GitHub's review interface.

**Option B - Post directly to GitHub**
Post the review using the GitHub API:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  --method POST \
  --field commit_id="{headRefOid}" \
  --field body="{summary_body}" \
  --field event="{APPROVE|REQUEST_CHANGES|COMMENT}" \
  --field comments='[{"path":"file.ts","line":42,"body":"Comment text"}]'
```

For inline comments, the `comments` array should contain objects with:

- `path`: File path relative to repo root
- `line`: Line number in the diff (use the NEW file line number)
- `body`: Comment text

**Important:** Before posting, show the user exactly what will be posted and confirm.

## Notes

- The review should be constructive and actionable
- Focus on significant issues rather than nitpicking style
- Acknowledge good patterns and practices in the Highlights section
- When in doubt about severity, prefer lower severity (Suggestion over Important)
