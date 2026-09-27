# Parallel agents

Run one agent or twenty on the same repo. The rule is **everyone reads the same memory, everyone
writes in their own space** — reading a why-pack never collides, only writing does, and writing is
isolated by git worktrees (one per agent, the harness's job). ReasonGraph is built to be a good citizen
under that:

- **Never touches your git index.** ReasonGraph never `git add`s, so the why-pack can't be swept into
  whatever another agent is committing. When it commits the why-pack it builds the commit on a
  *throwaway* index via `commit-tree`, so your real staging area — and any concurrent agent's — is
  never read or modified. (See [keeping git current](HOW-IT-WORKS.md#keeping-git-current).)
- **Per-session state.** Each session's bookkeeping is its own file
  (`.reasongraph/state/sessions/<id>.json`) — no shared state file for concurrent writers to clobber.
- **Work anywhere, push anywhere.** Discovery scans the whole worktree family, so a session that ran
  in one worktree is found when you push from another; decisions are filed under the branch you
  actually push.
- **Serialized distills.** A per-session lockfile keeps the `Stop` / `SessionEnd` / `pre-push`
  triggers from running over each other.

Then the [read side](HOW-IT-WORKS.md#the-read-side-agents-encounter-the-why-not-just-store-it) makes
sure a parallel agent sent to "reconcile with what changed" actually *encounters* the reasoning,
instead of guessing from `git log`.
