# ReasonGraph

**Make agent-written code reviewable.**

When a coding agent builds a feature, it makes a bunch of small decisions along the way that you never really approved. Later someone reviews the PR and asks "why was this done this way?" and you don't know. The answer is buried in a chat transcript on your laptop, and Claude Code deletes those after 30 days by default.

ReasonGraph reads your session transcripts locally, pulls out the decisions, and writes them to a markdown file that gets committed with your code. Now the repo can answer "why" on its own, for reviewers, teammates, and future agents.

```bash
npx --yes @borg0ai/reasongraph init      # seed .reasongraph/ + the Git pre-push hook
npx --yes @borg0ai/reasongraph install   # install the reasongraph/ plugin via npx plugins
```

`init` is per-repository and safe to re-run. `install` installs the plugin from
this repository's `reasongraph/` directory (its hooks and the `reasongraph`
skill) into whichever agent tools you use.

## What it looks like

Real example: on a contract project, my agent decided on its own to pre-create guest users in Clerk. It wasn't in any plan. The CTO saw it in the PR and asked me why. I had no idea, because I hadn't made that decision. With ReasonGraph, it would have been in the repo:

```markdown
### Guest identities are pre-created in Clerk
Status: agent-initiated — not requested in plan or prompts
Touches: `lib/clerk/*`, `db/schema/guests.ts`

The agent inferred this approach to simplify downstream auth checks.
No explicit rationale was discussed.

Risk: guest users diverge from the normal signup path.
Reviewer attention: confirm whether guests should be modeled as normal users.
```

Run `grep -rn "agent-initiated" .ai/why/` and you get a list of every decision the agent made without asking anyone.

## How it works

You don't run ReasonGraph by hand. It runs itself off hooks:

```bash
claude        # work normally, let the agent commit as it goes
git push      # ReasonGraph writes the why file and shows it to you for review
```

A few things worth knowing:

- It works from the transcript after the fact. It never asks the agent to "log its decisions" mid-task (we tried that first, agents just don't do it).
- Each branch gets one file: `.ai/why/<branch>.md`.
- Future agents see this. A note in `AGENTS.md` points them at the why files, and a hook injects relevant entries before an agent edits a file with history.
- It never blocks a push, never touches your staging area, and never pushes anything itself. It plays fine with multiple agents and worktrees.

**How a future agent meets the why** — two automatic triggers, both reading from the committed why-pack, so the agent never has to remember to go look:

```mermaid
flowchart TD
    why[("the why-pack<br/>(.ai/why/, committed)")]

    agents["AGENTS.md pointer<br/>auto-loaded every session"]
    hook["PreToolUse hook<br/>fires right before an edit"]

    agents -->|"why / explain / review"| read["agent reads<br/>the why-pack"]
    hook -->|"edited file matches a Touches: glob"| inject["matching entries injected<br/>into the agent's context"]

    why -.-> read
    why -.-> inject

    read --> meets["✅ agent meets the reasoning<br/>before it changes the code"]
    inject --> meets
```

No server, no accounts, no bot. It's a CLI, some hooks, and markdown files in git. Full detail in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Privacy

Your transcript never leaves your machine. The only thing that gets shared is the markdown summary, and the summarizer follows strict rules: it never quotes your messages, never describes your confusion or back-and-forth, never includes business or money details, and strips secrets. Two deterministic checks sit behind the prompt (a secret/finance scanner and a rule that every entry must point at real code), then you review the file before you push. If you edit or delete an entry, ReasonGraph respects that forever.

**Don't want anything committed at all?** `reasongraph init --self-only` runs in personal mode: why-packs stay on your machine as private notes — ignored through the repo's local `.git/info/exclude`, with no shared `AGENTS.md` changes, and forced to `sync: "manual"` so no code path can commit.

More detail in [docs/PRIVACY.md](docs/PRIVACY.md).

## What it's good for (we actually tested this)

We ran a blind, pre-registered eval against an honest baseline and published the whole thing, including the parts where the tool lost: [docs/REPORT.md](docs/REPORT.md).

Where it helps:

- **Saving reasoning before it's deleted.** Claude Code throws away transcripts after 30 days. Two of our own projects lost their entire history before we could even run the eval. `reasongraph init` offers to backfill whatever is still alive.
- **Knowledge that isn't in the code.** Things like "we considered a CDN and rejected it" or "the agent did this on its own, nobody approved it" leave no trace in the code. In our tests, agents with the why file got these right. Agents without it made up plausible-sounding wrong answers.

Where it doesn't help, honestly:

- It won't stop an agent from refactoring away important code. We tested that directly and it didn't.
- It doesn't make agents smarter in general. If the answer is readable from the code, agents find it fine on their own. ReasonGraph only matters for the stuff that's written down nowhere else.

## Commands

| Command | Purpose |
|---|---|
| `reasongraph init` | Seed `.reasongraph/`, the why-pack dir, and the Git pre-push hook. Per-checkout, safe to re-run. Offers to backfill local sessions. Add `--self-only` for a private, never-committed setup. |
| `reasongraph install` | Install the root ReasonGraph plugin into detected agent tools through `npx plugins add`. |
| `reasongraph status` / `doctor` | Health checks, what's distilled, what's stale. |
| `reasongraph context <path>` | Show the entries that apply to a file. |
| `reasongraph sync` | Distill and commit right now (still never pushes). |
| `reasongraph distill` / `repair` / `off` / `on` / `uninstall` | The rest. `--help` for details. |

## FAQ

**How is this different from Beads and the task-tracker tools?**
Those track what agents should do next. ReasonGraph records why things were already done. You could use both.

**Why not just turn off transcript deletion?**
You can, but then you have gigabytes of raw chat logs on one laptop that you'd never share with anyone. The why file is small, safe to share, and lives in the repo where your team and their agents can actually find it.

**Does it work with tools other than Claude Code?**
Anything can read the why files, since they're just markdown. Writing them currently requires Claude Code. A Codex adapter is next.

**Where are the deep dives?**
[Architecture and git behavior](docs/HOW-IT-WORKS.md) · [why-pack format](docs/FORMAT.md) · [parallel agents](docs/PARALLEL-AGENTS.md) · [config](docs/CONFIG.md)

## Development

```
apps/cli/        the @borg0ai/reasongraph CLI (TypeScript, Vite build, Vitest tests)
reasongraph/     the agent plugin installed by `reasongraph install` (hooks + skill)
docs/            deep dives: architecture, format, privacy, config, eval report
.spec/           RFCs, roadmap, task tracking
```

Design changes here start as an RFC under `.spec/rfc/`. Use the
[`specify`](https://github.com/borg0ai/specify) skill to create one, check its
status, advance or archive it, and keep `ROADMAP.md` / `TASK_TRACKING.md` /
`rfc/` consistent before committing.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Zero runtime dependencies; pure TypeScript. Vitest suite is hermetic — no Claude, API key, or network needed (the LLM is mocked, git runs in throwaway temp repos) — and requires Node >= 20.19 and git. It covers transcript parsing, why-pack merge and human-edit preservation, semantic dedupe, the privacy/secret/finance validator, per-session state and concurrency locking, branch attribution, plugin assets, and the scratch-index auto-commit. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
