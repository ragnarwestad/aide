# Development in aide

## Repo layout

**`dashboard/` came in with `git subtree add`, and its history is only
reachable through `git blame`.** `git log --follow -- dashboard/<file>`
and plain `git log -- dashboard/<file>` stop at the import commit and
show nothing older — that is how subtree boundaries work, not a sign the
move went wrong. `git blame dashboard/src/discover.ts` does attribute
every line to its original pre-merge commit and author. Measured on a
throwaway repo before the move and confirmed after (spec 85). The
standalone `aide-dashboard` repo is kept as a fallback but no longer
carries a manifest, so it is not a project in its own right anymore.

**Two toolchains, deliberately separate.** The repo root is pytest
(`pytest.ini`, no lockfile); `dashboard/` is bun + TypeScript
(`dashboard/bun.lock`). Project-command detection reads the ROOT only, so
aide's test command stays `pytest` — a `package.json` at the root would
silently redirect it, which
`tests/specs/unit/core/validation/test_dashboard_merge.py` guards
against. Run the dashboard's own suite from inside `dashboard/`:
`bunx tsc --noEmit && bun test`.

**The queue/worktree/merge/archive internals live in `dashboard/CLAUDE.md`
now** (moved 2026-08-26, /doctor check 4), not here — that content only
matters to a session actually working in `dashboard/`, and loads
automatically for one. It also documents `core/scripts/aide-run-spec`.

## Adding new functionality

**Moved to the `aide-repo-maintenance` skill** (2026-08-31, /doctor check
4): adding a skill, updating a shared rule, or changing the spec
structure only matters when actually doing one of those, not for
ordinary spec work in this repo — invoke it when you need it.
