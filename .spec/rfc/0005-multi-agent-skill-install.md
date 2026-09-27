# RFC 0005: Install the ReasonGraph skill for every detected agent

**Status:** Draft

## Summary

Keep one `SKILL.md` as the agent instruction source. Change `reasongraph install` so it publishes that skill through `npx skills` to the agents actually installed on the machine, at project scope by default and at user scope with `--global`. Keep the existing `npx plugins` hook install beside it.

## Problem

`reasongraph install` only runs `npx plugins add`. That reaches agents which understand the Vercel plugin layout. Many agents only load a `SKILL.md` from their own skills directory. A skill placed by hand under `~/.agents/skills` is invisible to the product install, and `npx skills add -a '*'` also targets catalog agents that have no global skills directory.

## How to use it

From a git repository, project scope installs the skill for agents detected in that repo:

```bash
reasongraph install
```

That runs, in the repository root:

```bash
npx --yes skills add borg0ai/dx-reasongraph --skill reasongraph -y
npx --yes plugins add borg0ai/dx-reasongraph --scope project --yes
```

User scope installs the same skill for detected agents that have a global skills directory:

```bash
reasongraph install --global
```

That adds `-g` to the `skills` invocation and does not run `plugins`. Plugin hooks stay project-scoped.

Do not pass `-a '*'`. The skills CLI then tries every agent in its catalog. Eve and PromptScript only accept a project skills directory, so a global wildcard install fails for them even when they are not in use. Project install without `-g` is how those two receive the skill, and only when the CLI detects them in the current repo.

Agents in the skills CLI "universal" group, including OpenCode and Codex, read `~/.agents/skills` or the repo's `.agents/skills`. One copy there covers that group. Other detected agents get a symlink to that copy.

ReasonGraph does not take a `.prs` file as input and does not shell out to
`prs compile`. Prompt Studio stays outside this flow. It is alpha, connects only
Claude Code and OpenCode, and those two already load the skill directories this RFC
writes.

PromptScript is still excluded as an *install* path: this RFC installs the skill
itself, and `npx skills add` already reaches the same targets without a compiler.
Using it to emit a reviewer agent instead — a capability neither install path
provides — is RFC 0006, which depends on this one.

## Goals

* Ship the existing root skill at `reasongraph/skills/reasongraph/SKILL.md` through `npx skills add borg0ai/dx-reasongraph --skill reasongraph`.
* Default `reasongraph install` to project scope for both the skill and the plugin.
* Add `reasongraph install --global` for user-level skill install only.
* Leave install successful when the universal skill copy is in place, and print per-agent skips for agents that reject the chosen scope.
* Tell the skill to run `npx --yes @borg0ai/reasongraph init` when neither `.reasongraph/config.json` nor `.reasongraph/state/config.json` exists, before `context` or `sync`.
* Lock the argv in Vitest.

## Non-goals

* Passing `-a '*'` or installing for agents that are not detected.
* Adopting PromptScript, Prompt Studio, or Eve as a required runtime or install path.
  RFC 0006 uses PromptScript additively, to emit an agent definition, without
  touching the install flow this RFC specifies.
* Moving why-packs. Path text in the skill follows RFC 0004 once that RFC is implemented.
* Changing distillation, hook behavior, or the published package name.

## Design

`apps/cli/src/commands/install.ts` grows a scope argument. Project scope is the default. `--global` is the other scope.

Project scope spawns `npx` twice in the repo root. First: `skills add borg0ai/dx-reasongraph --skill reasongraph -y`. Second: the current `plugins add borg0ai/dx-reasongraph --scope project --yes`. Global scope spawns only the skills command plus `-g`.

The skill file stays the single instruction source. Its "before changing code" steps gain the missing-config init check, then the existing `context` call. Its "after a decision" step stays `sync`. The why directory named in the skill is the directory the CLI reads. This RFC does not introduce a second path.

`reasongraph install` does not call `init`. Seeding `.reasongraph/` remains `reasongraph init`. The skill runs init only when both config files are absent.

A non-zero exit from an agent the skills CLI skips is reported and does not fail install when the universal copy exists. A failure to write that copy, or a failure of `npx plugins` in project scope, still fails install.

## Acceptance

* Vitest asserts project install argv for `skills` and `plugins`, and global install argv for `skills` only.
* Vitest asserts the root skill names `reasongraph init` for a missing config, then `context` and `sync` via `npx --yes @borg0ai/reasongraph`.
* `pnpm --filter @borg0ai/reasongraph test` passes.
* Docs for `reasongraph install` show the project command and the `--global` command.
