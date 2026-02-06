---
name: brainstorming-prd
description: "Brainstorming collaboratif pour transformer une idée en PRD (Product Requirements Document). Explore l'intention, les besoins et le design avant d'écrire un PRD structuré à la racine du projet. Utiliser pour toute réflexion produit nécessitant un PRD."
---

# Brainstorming Ideas Into PRDs

## Overview

Help turn ideas into fully formed PRDs (Product Requirements Documents) through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far. Finally, write a structured PRD at the project root.

## The Process

**Phase 1 — Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Phase 2 — Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Phase 3 — Presenting the design:**
- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling
- Be ready to go back and clarify if something doesn't make sense

## Phase 4 — Writing the PRD

Once the design is complete and validated:

1. Ask: "Ready to write the PRD?"
2. When user confirms, write a `PRD.md` file at the project root using the template below
3. Fill each section with the information gathered during the brainstorming phases

### PRD Template

```markdown
# PRD: [Title]

## Overview
[2-3 sentence summary of the product/feature]

## Problem Statement
[Problem to solve, context, and motivation]

## Goals & Success Criteria
[Measurable objectives and how success will be evaluated]

## User Stories
- As a [user], I want [action], so that [benefit]

## Functional Requirements
[Detailed functional requirements]

## Non-Functional Requirements
[Performance, security, scalability requirements]

## Technical Constraints
[Technical constraints identified during brainstorming]

## Out of Scope
[What is explicitly excluded from this effort]

## Open Questions
[Unresolved questions from the brainstorming session]
```

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense
