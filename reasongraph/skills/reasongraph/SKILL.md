---
name: reasongraph
description: Read and preserve repository decision history with the ReasonGraph CLI. Use when explaining unfamiliar code, reviewing changes against past decisions, or recording why a design choice was made.
---

# ReasonGraph

Use ReasonGraph to read repository decisions before changing code and to keep
important rationale available to future contributors.

## Before changing code

1. Run `npx --yes @borg0ai/reasongraph context <file-or-directory>` for the code being changed.
2. Read matching entries under `.reasongraph/why/` when the CLI reports prior decisions.
3. Treat those entries as project context; surface conflicts to the user before
   changing the recorded direction.

## After making a decision

When a non-obvious design choice is made, state the decision and rationale
clearly, then run `npx --yes @borg0ai/reasongraph sync` to record it. Review
`.reasongraph/why/` before sharing it.

## If CLI is unavailable

Read `.reasongraph/why/` directly. Do not invent project history or claim that a
decision was recorded when it was not.
