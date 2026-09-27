# RFC 0002: Move CLI to apps/cli and publish scoped npm package (child of 0001)

**Status:** Implemented

**Parent:** [0001](0001-reasongraph-cli-plugin-redesign.md)

## Summary

Move the CLI package and source into `apps/cli`, publish it as `@borg0ai/reasongraph`, and use Vite as its build command. Keep repository plugin assets outside the CLI npm package.

## Problem

The CLI currently builds from root `src/` with TypeScript and root package metadata. That layout cannot represent the requested monorepo boundary cleanly, and would couple plugin files to the CLI tarball.

## Goals

Create an `apps/cli` package with a `reasongraph` executable, a Vite-built Node entry, package-local CLI tests running under Vitest, and a CI release that publishes the scoped package publicly. Keep tests out of the published tarball.

## Non-goals

Plugin installation behavior, repository seeding behavior, plugin skill content, and legacy-name compatibility.

## Design

Make the repository root a private workspace coordinator. Move CLI implementation to `apps/cli/src`, CLI tests to `apps/cli/test`, and put package metadata, Vite config, Vitest config, and package lock under `apps/cli`. Configure Vite to bundle one Node-runnable CLI entry while leaving Node built-ins external; preserve executable shebang and runtime assets. Exclude source, tests, docs, and repository-root `reasongraph/` plugin assets from the npm tarball. Update root workspace scripts and CI so install/build/test run for `apps/cli`, and tag releases publish from that directory with public scoped-package access and provenance. Do not add aliases for the old package or executable name.

## Acceptance

`pnpm --filter @borg0ai/reasongraph build` produces the declared bin entry; invoking the built CLI prints help and runs commands from a temporary repository. `pnpm --filter @borg0ai/reasongraph test` runs the moved CLI suite through Vitest. `npm pack --dry-run` from `apps/cli` contains only CLI runtime files and excludes tests and root plugin assets. CI publishes `@borg0ai/reasongraph` from `apps/cli` with public access and provenance. No legacy package or executable aliases remain.
