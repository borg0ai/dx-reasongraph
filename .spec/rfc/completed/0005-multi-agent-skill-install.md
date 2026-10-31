# RFC 0005: Install the ReasonGraph skill for every detected agent

**Status:** Implemented

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
npx --yes skills@1.5.13 add borg0ai/dx-reasongraph --skill reasongraph --agent claude-code -y
npx --yes plugins add borg0ai/dx-reasongraph --scope project --yes
```

User scope installs the same skill for detected agents that have a global skills directory:

```bash
reasongraph install --global
```

That adds `-g` to the `skills` invocation and does not run `plugins`. Global install works outside a Git repository. Plugin hooks stay project-scoped.

ReasonGraph maintains a small detector for Antigravity, Claude Code, Codex, Cursor, and OpenCode. It uses `.gemini/antigravity/`, `.claude/`, `.codex/`, `.cursor/` or `.cursorrules`, and `.opencode/`, `opencode.json`, or `opencode.jsonc` in the repository. Global detection checks the matching agent directories under the user's home. It honors `CLAUDE_CONFIG_DIR` and `CODEX_HOME`; OpenCode uses `XDG_CONFIG_HOME/opencode`, or `~/.config/opencode` when `XDG_CONFIG_HOME` is unset. Do not pass `-a '*'` or rely on upstream detection: an empty detection with `-y` selects the full upstream catalog.

Pass every detected target with `--agent <name>`. If project detection is empty, pass only `--agent universal`; this writes the shared `.agents/skills` copy. If global detection is empty, report the missing targets and exit before running either installer. Eve and PromptScript remain outside the maintained detector because they have no matching ReasonGraph adapter or global skills directory.

Agents in the skills CLI "universal" group, including OpenCode and Codex, read `~/.agents/skills` or the repo's `.agents/skills`. One copy there covers that group. Other detected agents get a symlink to that copy.

ReasonGraph does not take a `.prs` file as input and does not shell out to
`prs compile`. Prompt Studio and PromptScript reviewer-agent generation stay
outside this install flow.

## Goals

* Ship the existing root skill at `reasongraph/skills/reasongraph/SKILL.md` through `npx skills add borg0ai/dx-reasongraph --skill reasongraph`.
* Default `reasongraph install` to project scope for both the skill and the plugin.
* Add `reasongraph install --global` for user-level skill install only.
* Pass explicit supported targets to the skills CLI and report installation failures.
* Tell the skill to run `npx --yes @borg0ai/reasongraph init` when neither `.reasongraph/config.json` nor `.reasongraph/state/config.json` exists, before `context` or `sync`.
* Lock the argv in Vitest.

## Non-goals

* Passing `-a '*'` or installing for agents that are not detected.
* Adopting PromptScript, Prompt Studio, or Eve as a required runtime or install path.
* Moving why-packs. Path text in the skill follows RFC 0004 once that RFC is implemented.
* Changing distillation, hook behavior, or the published package name.

## Design

`apps/cli/src/commands/install.ts` grows a scope argument. Project scope is the default and requires a Git repository. `--global` is the other scope and works from any directory. A small registry in `apps/cli/src/commands/skillAgents.ts` maps each supported agent to its project and global detection markers. The detector returns only those supported agent ids; the installer appends `universal` only when project detection is empty.

Project scope runs `npx --yes skills@1.5.13 add borg0ai/dx-reasongraph --skill reasongraph` with one explicit `--agent` pair per detected target, then runs the current project-scoped plugins command. Pin `skills` to 1.5.13 because it supports Node 18 and ReasonGraph supports Node 20.19; current upstream releases require Node 22.20. Global scope works from any directory and runs only the skills command with detected targets and `-g`.

The skill file stays the single instruction source. Its "before changing code" steps gain the missing-config init check, then the existing `context` call. Its "after a decision" step stays `sync`. The why directory named in the skill is the directory the CLI reads. This RFC does not introduce a second path.

`reasongraph install` does not call `init`. Seeding `.reasongraph/` remains `reasongraph init`. The skill runs init only when both config files are absent.

The `skills` CLI's non-interactive `-y` path selects every catalog agent when it detects none. Explicit `--agent` arguments keep the target set bounded. A non-zero skills or plugins command fails `reasongraph install`; the CLI reports the command's exit code.

## Acceptance

* Vitest asserts project install argv for `skills` and `plugins`, and global install argv for `skills` only.
* Vitest asserts project and global detection markers for Antigravity, Claude Code, Codex, Cursor, and OpenCode, including `CLAUDE_CONFIG_DIR` and `CODEX_HOME` overrides.
* With zero detected agents, project install explicitly targets only `universal`; it never lets `skills add -y` fall back to all catalog agents.
* With zero detected agents, global install exits with a clear error before invoking `skills` and leaves install destinations untouched, whether or not the current directory is a Git repository.
* The skills CLI is pinned to `skills@1.5.13`, which runs on Node 20.19.
* Vitest asserts the root skill names `reasongraph init` for a missing config, then `context` and `sync` via `npx --yes @borg0ai/reasongraph`.
* `pnpm --filter @borg0ai/reasongraph test` passes.
* Docs for `reasongraph install` show the project command and the `--global` command.
