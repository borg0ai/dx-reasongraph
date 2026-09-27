# RFC 0003: Install root ReasonGraph plugin and close skill CLI loop (child of 0001)

**Status:** Implemented

**Parent:** [0001](0001-reasongraph-cli-plugin-redesign.md)

## Summary

Keep the agent plugin at repository-root `reasongraph/`, install it with Vercel Labs' `npx plugins`, seed repositories separately with `reasongraph init`, and make the installed skill use the published ReasonGraph CLI to complete the read-record loop.

## Problem

Plugin files currently sit inside the CLI package boundary, and `install` and `init` responsibilities are conflated. That makes plugin installation depend on npm package contents and leaves the skill without a defined CLI-backed path for reading and persisting rationale.

## Goals

Store hooks and `skills/reasongraph/SKILL.md` under repository-root `reasongraph/`, outside `apps/cli`. Make `reasongraph install` invoke Vercel Labs' `npx plugins add` against the canonical repository source at project scope. Make `reasongraph init` seed only the current repository, including `.reasongraph/`. The skill calls the published CLI with `context` before relevant edits and `sync` after decisions. Keep plugin asset checks in Vitest.

## Non-goals

CLI source relocation, Vite bundling, npm package metadata, CI publication mechanics, and adding support for the former product name.

## Design

Keep the plugin source in top-level `reasongraph/` with hook and skill directories discovered by Vercel's `plugins` CLI. Do not place plugin assets inside `apps/cli` or the npm package tarball. Follow the [Vercel Labs `plugins` CLI README](https://app.unpkg.com/plugins@1.3.4/files/README.md) for local/repository source discovery and `plugins add <source> --scope project --yes`. Update `apps/cli/src/commands/install.ts` to invoke `npx plugins add` for the canonical repository shorthand/path; do not call `init` from this command. Update `apps/cli/src/commands/init.ts` and repo path/config helpers so `init` creates `.reasongraph/` state/config and repository seed files without invoking a plugin installer. Update the plugin skill to use `npx @borg0ai/reasongraph context <path>` before editing and `npx @borg0ai/reasongraph sync` after making non-trivial decisions, then review the generated why-pack. Add Vitest coverage for the root plugin's hook manifest, skill instructions, and the install/init separation.

## Acceptance

From a clean fixture repository, `reasongraph init` creates expected `.reasongraph/` seed files and never invokes `npx plugins`; `reasongraph install` invokes Vercel Labs' `npx plugins add` for the root `reasongraph/` source and never seeds the repo. Vitest checks the shipped hook/skill files and confirms the skill uses the published CLI's `context` and `sync` commands. A package dry run for `apps/cli` excludes `reasongraph/`, proving plugin remains independently installed. `npx plugins discover` reports the expected root plugin and supported hook/skill components.
