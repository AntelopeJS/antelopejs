---
name: subagent-driven-development
description: Execute plans using fresh subagents per task with spec and code quality reviews between tasks
user-invocable: false
---

# Subagent-Driven Development

## Overview

Execute implementation plans using fresh subagents for each task, with mandatory reviews between tasks. Three-phase cycle: implement → spec review → code quality review.

**Core principle:** Fresh context per task, skeptical reviews, fast iteration within session.

## When to Use

- You have a completed implementation plan (from @writing-plans)
- Tasks are independent enough to be executed by fresh subagents
- You want fast iteration with quality gates in current session

## The Three-Phase Cycle

For each task in the plan:

### Phase 1: Implement

1. Dispatch fresh subagent with `implementer-prompt.md` template
2. Subagent reads plan, detects mode (TDD/Non-TDD), implements task
3. Subagent verifies work using plan's verification method
4. Subagent commits only after verification passes (using @committing)
5. Subagent returns completion report

### Phase 2: Spec Review

1. Dispatch fresh subagent with `spec-reviewer-prompt.md` template
2. Subagent verifies implementation matches plan specs
3. Subagent re-runs the verification method from the plan
4. Returns PASS or FAIL with details
5. **If FAIL:** Loop back to Phase 1 with fixes

### Phase 3: Code Quality Review

1. **Only runs after Phase 2 PASS**
2. Dispatch fresh subagent with `code-quality-reviewer-prompt.md` template
3. **REQUIRED SKILLS:**
   - Use code-review-excellence for quality assessment
   - Use code-simplifier to simplify and clean up code
4. Returns quality assessment with simplification suggestions
5. **If issues found:** Address before next task

## Process Flow

```
┌─────────────────────────────────────────────────────────┐
│                    For Each Task                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐                                       │
│  │  Phase 1:    │                                       │
│  │  Implement   │──────────────────────┐               │
│  └──────────────┘                      │               │
│         │                              │               │
│         ▼                              │               │
│  ┌──────────────┐                      │               │
│  │  Phase 2:    │  FAIL                │               │
│  │  Spec Review │──────────────────────┘               │
│  └──────────────┘                                      │
│         │ PASS                                          │
│         ▼                                               │
│  ┌──────────────┐                                       │
│  │  Phase 3:    │                                       │
│  │  Code Review │                                       │
│  └──────────────┘                                       │
│         │                                               │
│         ▼                                               │
│     Next Task                                           │
└─────────────────────────────────────────────────────────┘
```

## TodoWrite Integration

Create TodoWrite at start with structure:

```
Task 1: [Name from plan]
  - [ ] Phase 1: Implement
  - [ ] Phase 2: Spec Review
  - [ ] Phase 3: Code Quality Review
Task 2: [Name from plan]
  - [ ] Phase 1: Implement
  ...
```

Update after each phase completion.

## Orchestrator Responsibilities

As the orchestrator (main agent), you:

1. **Create TodoWrite** from plan tasks
2. **Dispatch subagents** using Task tool with appropriate prompts
3. **Review subagent reports** between phases
4. **Handle failures** - dispatch fix attempts, escalate if stuck
5. **Track progress** - update TodoWrite after each phase
6. **Report to user** after each task cycle completes

## Subagent Dispatch Pattern

```
Task tool call:
- subagent_type: "general-purpose"
- prompt: [Load and fill template from prompt file]
- Include: plan file path, task number, relevant context
```

## Remember

- Fresh subagent = fresh context (no accumulated confusion)
- Spec review is skeptical - verify code, not claims
- **REQUIRED SKILLS:** Use code-review-excellence + code-simplifier for code quality reviews
- @committing for all commits
- Stop and escalate if spec review fails 3 times
- User can intervene between any phases
