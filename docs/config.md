# Configuration

`.reasongraph/config.json` is committed and shared with the team:

```json
{
  "distiller": { "backend": "claude", "model": "haiku", "concurrency": 3 },
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
| `distiller.backend` | `"claude"` (default) runs headless Claude Code (`claude -p`), reusing your existing auth — **zero API-key setup**. `"api"` uses `ANTHROPIC_API_KEY` directly, which also isolates distillation cost from your interactive Claude Code usage. |
| `distiller.model` | Model alias for the CLI (`haiku` default) or model id for the API backend. |
| `distiller.concurrency` | How many transcript chunks distill at once (default `3`). A big session is many chunks; concurrency is what keeps it inside the pre-push budget. The `claude` backend spawns a subprocess per call, so 3 is a safe default — heavy users on `backend: "api"` (plain HTTP) can raise it. |
| `chunkChars` | How much transcript goes to the model per call (default `100000`). Bigger means fewer calls, so less overhead, but a slower single call — which matters against `timeBudgetMs`. Rarely worth touching. |
| `redaction` | Extra "never leak this" regexes, layered on top of the built-in secret/privacy/finance checks. |
| `timeBudgetMs` | **Hard** wall-clock cap on the pre-push sweep. It's enforced between *and within* sessions (each model call's own timeout shrinks to the remaining budget), so one big session can't make a push hang. Work that doesn't fit is deferred with a message, never blocks the push, and is finished by the next background distill, `reasongraph sync`, or your next push. |
| `sync` | `"auto"` (default) commits the why-pack at settle points; `"manual"` never commits — you use `reasongraph sync` and the loud freshness status instead. See [keeping git current](HOW-IT-WORKS.md#keeping-git-current). |
| `autoDistill` | Tunes the debounced background distill on the `Stop` hook. Set `enabled: false` to only distill at session end and push. `minIntervalMs` and `minGrowthBytes` are the time/size thresholds before a background distill fires. |

Cranking up `autoDistill` (more frequent background distills) pairs well with
`"backend": "api"`, so the extra distillation doesn't draw down your interactive Claude Code
budget.
