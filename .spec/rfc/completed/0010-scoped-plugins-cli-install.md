# RFC 0010: Install the root plugin through npx @borg0ai/plugins

**Status:** Implemented

Supersedes the installer clause of [RFC 0003](completed/0003-root-plugin-install-skill-loop.md). Plugin location, init/install separation, and the skill's use of the ReasonGraph CLI stay as 0003 specified.

## Summary

`reasongraph install` runs one command: `npx --yes @borg0ai/plugins add borg0ai/dx-reasongraph --scope project --yes`. This repo does not contain the `@borg0ai/plugins` source. It is an external published package, not a workspace member.

## Problem

`apps/cli/src/commands/install.ts` kept a monorepo shortcut that walked `__dirname` to `packages/plugins/dist/index.js` and ran it with `node`. `__dirname` is not a package boundary: the bundled `dist/cli.js` resolves `../../..` to a different directory than the source does, and a published install has no sibling package. A local copy of the installer also duplicated a tool that already exists.

## Goals

- `install()` always spawns `npx` with `pluginInstallArgs()`.
- No `REPO_ROOT`, `LOCAL_PLUGINS_CLI`, or `existsSync` of another package's `dist`.
- The workspace holds only `apps/*`. No `packages/plugins` or `apps/plugins`.

## Non-goals

- Changing `reasongraph init`, the skill's `context` / `sync` calls, or RFC 0005's per-agent skill install.
- Adding a dependency from `@borg0ai/reasongraph` to `@borg0ai/plugins`.

## Acceptance

- `pluginInstallArgs()` deep-equals `["--yes", "@borg0ai/plugins", "add", "borg0ai/dx-reasongraph", "--scope", "project", "--yes"]`.
- `install.ts` has no `__dirname` walk and no path into any `plugins/dist`.
- `pnpm-workspace.yaml` lists `apps/*` only.
- `reasongraph init` still does not install the plugin.
