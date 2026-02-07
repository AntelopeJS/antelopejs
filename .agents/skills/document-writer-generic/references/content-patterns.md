# Content Patterns

Blog post structure, frontmatter, and Markdown patterns for documentation.

## Blog Post Frontmatter

```yaml
---
title: Post Title
description: Brief description for SEO and previews (under 160 chars)
image: /assets/blog/slug.png
author: Author Name
date: 2025-11-05
category: Release
tags:
  - feature
  - tutorial
---
```

**Categories**: `Release` (version announcements), `Article` (tutorials, guides)

## Blog Post Structure

1. **Opening** (1-2 paragraphs) - Announce what's new, why it matters
2. **Key callout** - Note blockquote with requirements/prerequisites
3. **Feature sections** - `## Feature Name` headers
4. **Code examples** - With file path labels
5. **Breaking changes** - If release post
6. **Thank you** - Credit contributors
7. **Resources** - Links to docs, repo
8. **Release link** - Link to full changelog

## Callout Patterns

Use blockquotes with bold prefixes for callouts:

| Need            | Markdown Pattern       | When                       |
| --------------- | ---------------------- | -------------------------- |
| Background info | `> **Note:** ...`      | Supplementary context      |
| Best practice   | `> **Tip:** ...`       | Recommendations            |
| Potential issue | `> **Warning:** ...`   | Things that could go wrong |
| Must-know       | `> **Important:** ...` | Required actions           |
| Danger          | `> **Caution:** ...`   | Destructive operations     |

### Callout Examples

```md
> **Note:** This feature requires version 4.0 or later.

> **Tip:** For better performance, enable component detection.

> **Warning:** This will overwrite existing files.

> **Important:** You must configure the database before starting.

> **Caution:** This action cannot be undone.
```

## Sequential Steps

Use numbered lists for multi-step instructions:

````md
1. Install the module

   ```bash
   npm install @example/module
   ```

2. Configure the settings

   ```ts [config.ts]
   export default {
     module: true,
   };
   ```

3. Restart the development server

   ```bash
   npm run dev
   ```
````

## Code Block Labels

Always include file path when relevant:

````md
```ts [config.ts]
export default defineConfig({
  modules: ['@example/content'],
});
```

```vue [pages/index.vue]
<template>
  <div>Hello</div>
</template>
```

```bash
npm install @example/content
```
````

## Code Alternatives

Show multiple implementations with separate labeled blocks:

````md
### Using Zod

```ts [validation.ts]
import { z } from 'zod';
const schema = z.object({ name: z.string() });
```

### Using Valibot

```ts [validation.ts]
import * as v from 'valibot';
const schema = v.object({ name: v.string() });
```
````

Package manager variants:

````md
**pnpm:**

```bash
pnpm add @example/content
```

**npm:**

```bash
npm install @example/content
```

**yarn:**

```bash
yarn add @example/content
```
````

## Expandable Sections

Use HTML details for advanced content:

```md
<details>
<summary>Advanced configuration options</summary>

Additional content here that is hidden by default.

You can include:

- Lists
- Code blocks
- Any markdown content

</details>
```

## Links and CTAs

Use standard Markdown links:

```md
<!-- Inline link -->

See the [configuration guide](/docs/getting-started/configuration).

<!-- Call to action -->

[Get started with the documentation](/docs/getting-started)

<!-- External link -->

[View on GitHub](https://github.com/example/repo)
```

For prominent CTAs, use bold links:

```md
**[Download the latest version](https://example.com/download)**
```

## Cross-References

Link to related content:

```md
<!-- Inline link -->

See the [configuration guide](/docs/getting-started/configuration).

<!-- Learn more pattern -->

[Learn more about data fetching](/docs/api/composables/use-fetch)

<!-- Related reading -->

**Related:** [Authentication guide](/docs/guides/authentication) | [API reference](/docs/api)
```

## Images

```md
![Alt text description](/assets/blog/image.png)

<!-- With caption -->

![Screenshot of the dashboard](/assets/blog/dashboard.png)
_The new dashboard interface_
```

## Tables

```md
| Feature | Status | Notes |
| ------- | ------ | ----- |
| Auth    | ✅     | Ready |
| Cache   | 🚧     | WIP   |
| Search  | ❌     | TODO  |
```

## Checklist for Documentation

- [ ] Clear, descriptive title
- [ ] Explanation before code examples
- [ ] File path labels on all code blocks
- [ ] Appropriate callout types (Note, Tip, Warning, etc.)
- [ ] Links to related documentation
- [ ] No backticks in H1 headings
- [ ] Present tense throughout
- [ ] Active voice (85%+)
