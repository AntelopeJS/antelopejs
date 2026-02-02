---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

## Mode Selection

**Ask the user before writing the plan:**

"Which development approach do you prefer?

- **TDD** - Test first, then implementation (red-green-refactor cycle)
- **Non-TDD** - Direct implementation without tests"

**If Non-TDD selected, also ask:**

"How should work be verified for each task?

- Manual testing (describe what to check)
- Run a command (e.g., `pnpm run build`, `pnpm run lint`)
- Visual inspection
- Other (describe)"

Document the chosen verification method in the plan header.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**

**Mode TDD:**

- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

**Mode Non-TDD:**

- "Implement the functionality" - step
- "Verify using [verification method from plan]" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Mode:** TDD / Non-TDD

**Verification Method (Non-TDD only):** [How to verify each task - command, manual steps, etc.]

---
```

## Task Structure

### Template TDD

````markdown
### Task N: [Component Name]

**Files:**

- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`
- Test: `tests/exact/path/to/file.spec.ts`

**Step 1: Write the failing test**

```typescript
describe('specificBehavior', () => {
  it('should return expected result', () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });
});
```
````

**Step 2: Run test to verify it fails**

Run: `pnpm run test tests/path/file.spec.ts`
Expected: FAIL with "myFunction is not defined"

**Step 3: Write minimal implementation**

```typescript
export function myFunction(input: string): string {
  return expected;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm run test tests/path/file.spec.ts`
Expected: PASS

**Step 5: Commit**

Use @committing skill

````

### Template Non-TDD

```markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`

**Step 1: Implement the functionality**

```typescript
export function myFunction(input: string): string {
  return expected;
}
````

**Step 2: Verify**

Run: [Verification method from plan header]
Expected: [Expected result]

**Step 3: Commit**

Use @committing skill

```

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills with @ syntax
- DRY, YAGNI, frequent commits, verification before commit

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use subagent-driven-development
- Stay in this session
- Fresh subagent per task + code review

**If Parallel Session chosen:**
- **REQUIRED SUB-SKILL:** New session uses executing-plans
```
