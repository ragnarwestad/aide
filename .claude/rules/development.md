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

## What gets installed where

Everything is installed **globally** — not per project. `./install-all.sh`
(repo root) runs each `implementations/<ai>/install.sh`. Each installer
starts with `core/scripts/aide-preflight <tool>` (informational only) and
is self-contained: the shared scripts (`core/scripts/` → `~/.local/bin/`,
listed once in `core/scripts/_install-bin.sh` and sourced as
`install_common_bin`) plus its own AI-specific setup. `aide-emit-run` and
`aide-run-spec` are opt-in and inert until something invokes them.

- **Individual uninstallers never remove the shared scripts**, nor the
  skills in `~/.agents/skills/` — other tools and the cron job depend on
  them. Only `uninstall-all.sh` calls `uninstall_common_bin` and
  `uninstall_agents_skills`, as its final steps.
- **The PATH block in `~/.zshenv` and `~/.bashrc`** (`install_shell_path`
  in `core/scripts/_install-bin.sh`) follows the same contract, and exists
  because `ssh host 'command'` is a non-interactive shell that reads
  neither `.zprofile`, `.zshrc` nor `.bash_profile`. It carries STABLE
  directories only, and is PREPENDED to `~/.bashrc` — most templates
  return early for a non-interactive shell — while appended to `~/.zshenv`.

## Adding new functionality

**Moved to the `aide-repo-maintenance` skill** (2026-08-31, /doctor check
4): adding a skill, updating a shared rule, or changing the spec
structure only matters when actually doing one of those, not for
ordinary spec work in this repo — invoke it when you need it.
