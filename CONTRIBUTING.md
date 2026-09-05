# Contributing to aide

## Table of contents

- [Before you start](#before-you-start)
- [Two toolchains](#two-toolchains)
- [Running the tests](#running-the-tests)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)

## Before you start

For anything beyond a small fix, open an issue first to discuss the change —
`aide` is opinionated about its own structure, and a change that fights that
structure is easier to steer before it's written than after.

## Two toolchains

The repo root is Python (pytest, no lockfile); `dashboard/` is a separate
Bun + TypeScript project (`dashboard/bun.lock`). Keep changes to one or the
other — see `.claude/rules/development.md` for why they stay separate.

## Running the tests

```bash
.venv/bin/pytest                    # the root's gate
cd dashboard && make test           # the dashboard's gate (tsc --noEmit, then bun test)
```

Both must pass before a pull request is reviewed.

## Commit messages

Write commit messages in English, in the imperative mood ("Add x", not
"Added x").

## Pull requests

Keep a pull request scoped to one change. Describe what it does and why;
the diff already shows what changed.
