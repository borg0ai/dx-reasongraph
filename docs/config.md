# Configuration

`.reasongraph/config.json` is committed and shared with the team:

```json
{
  "distiller": {
    "backend": "agent",
    "models": { "claude": "haiku", "agent": "auto", "codex": "gpt-6-luna" },
    "concurrency": 3
  },
  "redaction": ["INTERNAL_CODENAME"],
  "timeBudgetMs": 60000,
  "chunkChars": 100000,
  "sync": "auto",
  "autoDistill": { "enabled": true, "minIntervalMs": 180000, "minGrowthBytes": 15360 }
}
```

This is the default; every key is optional. Override only what you have a reason to —
the defaults are what the eval ran against. Note `selfOnly` is absent above on purpose: it's
personal, not shared, so it lives in the local file only (see below).

## Two config files, one effective config

```
defaults  <-  .reasongraph/config.json (committed)  <-  .reasongraph/state/config.json (local)
```

The committed file is the team's. The local file is per-machine and gitignored — the right
place for a path, a model, or anything specific to your laptop. Later layers win, and the
merge is a deep merge, so you only write the key you're changing.

`selfOnly` belongs in the **local** file. It's set for you by `reasongraph init --self-only`
and forces `sync` to `"manual"` no matter what the shared file says, so no code path can
commit in personal mode.

| key | what it does |
|---|---|
| `distiller.backend` | Which CLI distills. `"agent"` (default) runs Cursor's `agent -p --mode ask` (read-only), model `models.agent`. `"claude"` runs `claude -p`. `"codex"` runs `codex exec` in a read-only sandbox. Each CLI uses its own login. |
| `distiller.models` | Model id for each CLI. The running backend uses only its own key: `models.claude`, `models.agent`, or `models.codex`. Changing `backend` does not reuse another CLI's model. |
| `distiller.concurrency` | How many transcript chunks distill at once (default `3`). Each call spawns a CLI, so 3 stays inside the pre-push budget. |
| `chunkChars` | How much transcript goes to the model per call (default `100000`). Bigger means fewer calls, so less overhead, but a slower single call — which matters against `timeBudgetMs`. Rarely worth touching. |
| `redaction` | Extra "never leak this" regexes, layered on top of the built-in secret/privacy/finance checks. |
| `timeBudgetMs` | **Hard** wall-clock cap on the pre-push sweep. It's enforced between *and within* sessions (each model call's own timeout shrinks to the remaining budget), so one big session can't make a push hang. Work that doesn't fit is deferred with a message, never blocks the push, and is finished by the next background distill, `reasongraph sync`, or your next push. |
| `sync` | `"auto"` (default) commits the why-pack at settle points; `"manual"` never commits — you use `reasongraph sync` and the loud freshness status instead. See [keeping git current](HOW-IT-WORKS.md#keeping-git-current). |
| `autoDistill` | Tunes the debounced background distill on the `Stop` hook. Set `enabled: false` to only distill at session end and push. `minIntervalMs` and `minGrowthBytes` are the time/size thresholds before a background distill fires. |

A local override switches CLI without changing the committed default:

```json
{ "distiller": { "backend": "claude", "models": { "claude": "haiku" } } }
```

`codex` is the same shape. Auth errors come from the CLI itself.
