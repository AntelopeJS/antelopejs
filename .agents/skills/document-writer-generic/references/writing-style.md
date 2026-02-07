# Writing Style Guide

Writing conventions for documentation: sentence structure, voice, tone, and formatting.

## Sentence Patterns

| Pattern       | Usage | Example                                            |
| ------------- | ----- | -------------------------------------------------- |
| Subject-first | 60%   | "The `useFetch` composable handles data fetching." |
| Imperative    | 25%   | "Add the following to `config.ts`."                |
| Contextual    | 15%   | "When using authentication, configure..."          |

### Subject-First (Declarative)

Place the subject before the verb:

```
✅ "The module creates a connection to the database."
✅ "The library provides SQL-backed queries."
❌ "A connection is created by the module." (passive)
```

### Imperative

Direct instructions for actions:

```
✅ "Run the following command."
✅ "Add this configuration to your file."
✅ "Install the required dependencies."
```

### Contextual Opening

Start with "When", "If", "For", "After":

```
✅ "When deploying to production, set the NODE_ENV variable."
✅ "If validation fails, the error is returned immediately."
✅ "For custom themes, define CSS variables."
```

## Voice

**Active voice: 85%**

```
✅ "The middleware checks authentication."
❌ "Authentication is checked by the middleware."
```

**Passive voice allowed when:**

- Actor is unknown: "The file was generated automatically."
- Object emphasis: "The configuration is loaded at startup."
- System behavior: "Errors are logged to the console."

## Tense

**Present tense: 90%**

```
✅ "The function returns a promise."
✅ "The framework automatically imports components."
❌ "The function will return a promise." (future)
```

**Past tense** for completed actions:

```
✅ "v3.0 introduced the new query API."
```

## Modal Verbs

| Verb     | Meaning     | Example                                  |
| -------- | ----------- | ---------------------------------------- |
| `can`    | Optional    | "You can customize the theme."           |
| `should` | Recommended | "You should use TypeScript."             |
| `may`    | Possibility | "This may cause performance issues."     |
| `must`   | Required    | "You must configure the database first." |

## Paragraph Structure

- **2-4 sentences** per paragraph
- **Topic sentence first** - state the main point
- **Supporting details** follow
- **No meta-commentary** like "This section explains..."

```
❌ "This page describes how to configure the database."
✅ "Configure the database in `config.ts`."
```

## Avoid

- **Unclear pronouns**: "It" without clear referent
- **Stacked prepositions**: "in the configuration of the module"
- **Qualifiers**: "Note that", "Please note", "It should be noted"
- **Filler words**: "actually", "basically", "simply"
- **Over-qualification**: "very", "really", "extremely"

## Tone by Content Type

| Content Type    | Tone          | Example                                 |
| --------------- | ------------- | --------------------------------------- |
| Getting Started | Welcoming     | "Let's set up your first project."      |
| Guides          | Instructional | "Configure the middleware as follows."  |
| API Reference   | Precise       | "Returns `Promise<void>`."              |
| Troubleshooting | Empathetic    | "If you encounter this error, check..." |

## Code References

- **Inline code** for identifiers: `useFetch`, `config.ts`
- **Code blocks** for multi-line examples
- **Always include file path labels** on code blocks

````md
```ts [config.ts]
export default defineConfig({});
```
````

## Lists

- Use **bulleted lists** for unordered items
- Use **numbered lists** for sequential steps
- Keep items **parallel** in structure

```
✅ Bulleted:
- Install dependencies
- Configure the module
- Start development server

✅ Numbered:
1. Create a new file
2. Add the configuration
3. Restart the server
```

## Headings

- **H1 (`#`)**: No backticks (don't render properly in some renderers)
- **H2-H4**: Backticks work fine
- Use **sentence case**: "Configure the database"
- Avoid **gerunds**: "Configuring" → "Configure"

## Best Practices Summary

| Do                          | Don't                             |
| --------------------------- | --------------------------------- |
| Active voice (85%)          | Passive voice throughout          |
| Present tense               | Future tense for current behavior |
| Subject-first sentences     | Inverted sentence structures      |
| 2-4 sentences per paragraph | Wall of text                      |
| File path labels on code    | Unlabeled code blocks             |
| Precise modal verbs         | Vague "you might want to"         |
