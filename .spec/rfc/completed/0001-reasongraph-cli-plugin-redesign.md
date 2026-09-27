# RFC 0001: ReasonGraph CLI and plugin redesign (Umbrella)

**Status:** Implemented

**Type:** Umbrella

## Summary

Separate the ReasonGraph CLI's npm package from the repository-root agent plugin while keeping one documented install and usage flow. This umbrella tracks CLI packaging and plugin/skill lifecycle through its two child RFCs.

## Problem

The current repository puts CLI source, tests, publication metadata, and agent assets under one package boundary. The requested design gives the CLI and agent plugin distinct install paths and owners, so each concern needs independent acceptance and release checks.

## Goals

Both children are Implemented and their cross-boundary contract is verified: CLI install resolves the repository-root plugin, repository init seeds `.reasongraph/`, and the installed skill can use the published CLI to read and persist decision context.

## Non-goals

New ReasonGraph product capabilities, changes to decision distillation semantics, and compatibility with the former product name.

## Children

| RFC | Concern |
|-----|---------|
| [0003](0003-root-plugin-install-skill-loop.md) | Install root ReasonGraph plugin and close skill CLI loop |
| [0002](0002-cli-package-vite-npm.md) | Move CLI to apps/cli and publish scoped npm package |

## Acceptance

Close when both child RFCs are Implemented and the combined install, init, and skill-to-CLI flow passes acceptance. New requirements after closure belong in new RFCs.
