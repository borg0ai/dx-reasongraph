# RFC 0011: Create .reasongraph ignore rules during shared init

**Status:** Implemented

## Summary

Make shared-mode `reasongraph init` create `.reasongraph/.gitignore` so the directory shares only its configuration and why-packs. Stop changing the repository-root `.gitignore`; keep local state and other generated files out of normal Git status through the nested file.

## Problem

Shared-mode init creates `.reasongraph/config.json`, `.reasongraph/why/`, and `.reasongraph/state/`, then changes the repository-root `.gitignore` to hide state. This spreads ReasonGraph ignore policy across two files, while other generated files in `.reasongraph/` can still appear as untracked files. Init should own one nested ignore file instead.

## Goals

- Shared-mode init creates `.reasongraph/.gitignore` when absent.
- Ignore entries directly under `.reasongraph/` by default.
- Allow `.gitignore`, `config.json`, and `why/` to be tracked.
- Preserve an existing `.reasongraph/.gitignore` without overwriting user edits.
- Keep repeated init runs idempotent.
- Stop adding `.reasongraph/state/` to the repository-root `.gitignore`.
- Leave self-only mode on its current `.git/info/exclude` behavior.

## Non-goals

- Remove an existing `.reasongraph/state/` entry from the root `.gitignore`.
- Change which why-pack files ReasonGraph writes or commits.
- Remove or untrack existing files.
- Create a shared `.reasongraph/.gitignore` in self-only mode.

## Design

In `apps/cli/src/commands/init.ts`, add an idempotent helper that writes a fixed ignore template to `.reasongraph/.gitignore` only when the file is absent. Call it from `setupShared`, after creating the shared config directory. The template ignores `/*` and re-includes `.gitignore`, `config.json`, and `why/`; this also ignores `state/` and other local artifacts. Remove the call that adds `.reasongraph/state/` to the repository-root `.gitignore`, but leave any existing root entry untouched. Do not create the nested file from `setupSelfOnly`; that mode keeps using `.git/info/exclude` and must not create shared artifacts.

Implementation tasks:

### Task 1

Add the shared ignore-file template and creation helper in `init.ts`, call it from shared setup without replacing an existing nested file, and stop modifying the repository-root `.gitignore`.

### Task 2

Update the focused init acceptance coverage to check the generated rules, preservation of a pre-existing file, idempotency, and self-only behavior.

## Acceptance

- A clean shared-mode init creates `.reasongraph/.gitignore` with rules that ignore other top-level entries and allow `.gitignore`, `config.json`, and `why/`.
- A second shared-mode init leaves the file unchanged.
- Shared-mode init preserves custom contents when the file already exists.
- Self-only init does not create or modify `.reasongraph/.gitignore`.
- Shared-mode init does not add or remove entries in the repository-root `.gitignore`.
- The nested ignore rules exclude `.reasongraph/state/` and other generated local files.
