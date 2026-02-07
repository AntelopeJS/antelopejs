---
name: document-writer-generic
description: Writing guidance for blog posts and documentation using standard Markdown syntax
user-invocable: false
---

# Documentation Writer (Generic Markdown)

## Overview

Writing guidance for blog posts and documentation using standard Markdown syntax.

## When to Use

- Writing blog posts or documentation for any project
- Creating or editing Markdown content
- Ensuring consistent writing style across content
- Projects not using MDC or Nuxt Content

## Writing Standard

**Override**: When writing documentation, maintain proper grammar and complete sentences. The "sacrifice grammar for brevity" rule does NOT apply here.

Documentation must be:

- Grammatically correct
- Clear and unambiguous
- Properly punctuated
- Complete sentences (not fragments)

Brevity is still valued, but never at the cost of clarity or correctness.

## Available References

| Reference                                                            | Purpose                                         |
| -------------------------------------------------------------------- | ----------------------------------------------- |
| **[references/writing-style.md](references/writing-style.md)**       | Voice, tone, sentence structure                 |
| **[references/content-patterns.md](references/content-patterns.md)** | Blog frontmatter, structure, component patterns |

**Load based on context:**

- Writing prose → [references/writing-style.md](references/writing-style.md)
- Blog structure and patterns → [references/content-patterns.md](references/content-patterns.md)

## Quick Reference

### Writing Patterns

| Pattern       | Example                                            |
| ------------- | -------------------------------------------------- |
| Subject-first | "The `useFetch` composable handles data fetching." |
| Imperative    | "Add the following to `config.ts`."                |
| Contextual    | "When using authentication, configure..."          |

### Modal Verbs

| Verb     | Meaning     |
| -------- | ----------- |
| `can`    | Optional    |
| `should` | Recommended |
| `must`   | Required    |

### Callout Patterns (WHEN to use)

| Need              | Markdown Pattern                               |
| ----------------- | ---------------------------------------------- |
| Info aside        | `> **Note:** ...`                              |
| Suggestion        | `> **Tip:** ...`                               |
| Caution           | `> **Warning:** ...`                           |
| Required          | `> **Important:** ...`                         |
| Danger            | `> **Caution:** ...`                           |
| CTA               | `[Label](url)`                                 |
| Multi-source code | Separate code blocks with titles               |
| Expandable        | `<details><summary>...</summary>...</details>` |

## Headings

- **H1 (`#`)**: No backticks — they don't render properly in some renderers
- **H2-H4**: Backticks work fine

## Checklist

- [ ] Active voice (85%+)
- [ ] Present tense
- [ ] 2-4 sentences per paragraph
- [ ] Explanation before code
- [ ] File path labels on code blocks
- [ ] Appropriate callout types
- [ ] No backticks in H1 headings
