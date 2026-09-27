# RFC 0006: Ship a why-pack-aware reviewer agent via PromptScript

**Status:** Draft

## Summary

Define a `reasongraph-reviewer` agent in a `.prs` source and compile it to each
platform's native agent definition, with the ReasonGraph skill preloaded. Add a CI
step that compiles the same source for every supported target so the generated
output is verified without shipping it to users. PromptScript is additive: it does
not replace `npx skills add` or `npx plugins`, and `reasongraph install` is
unchanged.

## Problem

The managed `AGENTS.md` pointer is the only read-side mechanism outside Claude
Code's hook injection, and it is passive. The pointer states where the why-pack
lives and instructs the agent to read it, but nothing makes reading it a property
of the agent rather than a request it may decline. A reviewer spawned to grade a
diff arrives with no why-pack in context, so it reconstructs intent from names and
commit messages — the exact failure the eval measured.

RFC 0005 widens *where the skill is installed*. It does not change *what the agent
is*. Both `npx skills add` and `npx plugins` deliver flat instruction files; neither
emits an agent definition. There is currently no path to shipping a reviewer whose
identity already includes the decision history.

The migration from `CLAUDE.md` to `AGENTS.md` widened the pointer's reach but not
its authority. This RFC addresses authority, not reach.

## Goals

* Ship a reviewer agent that carries the ReasonGraph skill, to platforms with a
  native agent concept.
* Verify in CI that the `.prs` source compiles for every targeted platform.
* Leave the `reasongraph install` flow, the skill file, and the hook manifest
  byte-identical, so RFC 0005 and RFC 0004 stay valid and independently shippable.
* Keep the `.prs` source in the repository, not in a release pipeline, so the agent
  definition is reviewable in a PR like any other artifact.

## Non-goals

* Compiling hooks. `reasongraph/hooks/hooks.json` stays hand-maintained and remains
  the only hook source.
* Replacing `npx skills add` or `npx plugins` in `reasongraph install`.
* Serving `--global` scope. PromptScript accepts only a project skills directory,
  which RFC 0005 already documented as the reason its own global path uses
  `npx skills`.
* Committing generated output for platforms ReasonGraph does not already target.
* Changing distillation, the why-pack format, or the CLI package.

## Design

Add `.prs` at the repository root. It declares the existing `reasongraph` skill by
reference and one agent that preloads it:

```
@agents {
  reasongraph-reviewer: {
    description: "Review changes against the reasons they were made"
    skills: ["reasongraph"]
  }
}
```

The agent's body states the review contract: read the why-pack entries whose
`Touches:` match the changed files before judging the diff, and treat an entry's
`Status: agent-initiated` as requiring explicit scrutiny. It does not restate the
skill's steps — the skill is preloaded, so duplicating them would create a second
copy to drift.

`skillBaseDir` is set so emitted skills land under the repository's existing
`reasongraph/skills/` layout rather than a generated tree at the root. A
monorepo-scoped `builds` entry covers the `apps/cli` offset if the CLI ever gains
its own agent.

CI gains one step after `pnpm install`, running `prs compile` for the full target
list with output discarded. A non-zero exit fails the build. This catches a `.prs`
that no longer compiles for a platform we claim to support, without publishing
anything. The generated output is a verification artifact, not a committed one.

Targets are limited to those with verified native agent output. Platforms that
report `PS4002` for agents are excluded from the CI list rather than tolerated,
so the gate stays meaningful. A target that starts reporting `PS4002` fails CI and
gets removed deliberately.

## Risks

* PromptScript is a third-party compiler in the build path. Its releases can change
  emitted formats or the CLI surface. The blast radius is bounded — the compile
  step writes to a throwaway directory and the CLI does not depend on it — but a
  breaking upstream release turns CI red for a reason unrelated to this codebase.
* `@agents` support and emitted agent formats are less widely exercised than
  `@skills`. The compile gate is what converts that uncertainty into a visible
  failure instead of a silent bad file in a release.
* Two skill copies now exist in the repository: `reasongraph/skills/reasongraph/`
  as the install source, and whatever `prs` emits for verification. Emitted output
  is discarded in CI, so this stays a CI-time concern only.

## Acceptance

* `.prs` declares `reasongraph-reviewer` with the `reasongraph` skill preloaded.
* `prs compile` succeeds for every target in the CI list; the list contains no
  target that reports `PS4002` for `@agents`.
* The compile step runs in CI, discards its output, and fails the build on error.
* `reasongraph/skills/reasongraph/SKILL.md` and
  `reasongraph/hooks/hooks.json` are unchanged by this RFC.
* `reasongraph install` argv assertions in `apps/cli/test/plugin.test.ts` are
  unchanged.
* `pnpm --filter @borg0ai/reasongraph test`, typecheck, build, and
  `specify sync-check` pass.
