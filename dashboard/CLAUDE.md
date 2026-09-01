# Development in aide/dashboard

What a session working under `dashboard/` has to know before changing the
queue, the worktrees, the landing or the archive step: the things that
are easy to get backwards. Each rule names the page in `docs/` that says
why. Much of this also governs `core/scripts/aide-run-spec`, the
dashboard's execution backend — a session editing that script directly
should read this file by hand.

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

## How a run touches the repositories

`docs/running-specs.md`, "How a run touches the repositories".

- `aide-run-spec` branches EVERY repo it touches, and pushes a repo only
  when its HEAD moved — never on `changedFiles`, which a step that commits
  its own work leaves at `0`.
- It works in `git worktree` checkouts under
  `$HOME/aide-worktrees/<project>/<spec>/`. The result's `repos[].root` is
  the MAIN checkout; `repos[].worktree` is the throwaway one.
- Gitignored paths reach a worktree only through `worktreeLinks:` in the
  committed manifest; `.aide/config`'s `AIDE_WORKTREE_LINKS` is the
  fallback, and the manifest wins.
- A run reaches the project and its specs root, and nothing else.
- The script runs from a private copy of itself — an `implement` step
  reinstalls it under bash's feet — and `/bin/bash` here is 3.2: no
  `mapfile`, build arrays with `array+=(...)`.

## The hand-paired bash/TypeScript pairs

`core/scripts/aide-run-spec` and the dashboard make several of the same
decisions with no shared source. Each pair is pinned by a test that reads
both sides, so drift is caught — but the two copies still have to be
edited by hand together.

| Decision | bash | TypeScript | Pinned by |
|---|---|---|---|
| `WORKFLOW_STEPS` — the steps that exist | `aide-run-spec` | `dashboard/src/queue/steps.ts` | `test_aide_run_spec.py` |
| `DEPENDENCY_GATED_STEPS` — the steps an unarchived dependency holds back | `aide-run-spec` | `dashboard/src/serve/serve-helpers/config.ts` | `test_the_two_copies_of_the_dependency_gate_agree` |
| Project readiness — the read-only prerequisites a run needs | `aide-run-spec` | `assessProjectReadiness()` in `dashboard/src/project/project-admin/readiness.ts` | `tests/fixtures/project-readiness-prerequisites.json` |
| `worktreeLinks` precedence — manifest over `.aide/config` | `aide_manifest_get` + `aide-run-spec` | `resolveWorktreeLinks` in `dashboard/src/project/discover/config.ts` | `tests/fixtures/worktree-links-precedence.json` |
| `errorReason` — `"conflict" \| "unlanded"` | — | `dashboard/src/queue/types.ts` and `dashboard/src/render/ui/job-state/types.ts`, which do not import each other | `dashboard/test/queue/parsing-schedule-and-errors.test.ts` reads both as text |
| `codeLanding` — whether code is reviewed before it lands | one anchored `sed` in `aide-run-spec` | `resolveCodeLanding` in `dashboard/src/project/discover/config.ts` | `tests/fixtures/code-landing-precedence.json` |
| The status-mark rule — which Status cells count as done | `total_progress_for` in `aide-run-spec` | `isDoneMark` in `dashboard/src/project/parse-status.ts` | `tests/fixtures/status-row-counting.json` |

The workflow arc is a further copy of the step list: `WORKFLOW_ARC` in
`aide-run-spec`, `HISTORY_STEPS` in `dashboard/src/git/workflow-history.ts`
and `WORKFLOW_STEPS` in `dashboard/src/project/parse-status.ts` all name
the four stages `create`, `analyze`, `implement`, `archive`. Review is
part of `analyze`, not a stage: the three-reviewer routine runs inline in
`core/skills/aide-analyze/SKILL.md`, as separate Agent invocations blind
to the analyst's own reasoning.

Two known asymmetries in the readiness pair are named in that test's own
exclusion list rather than in the fixture: `specsRepo` is a check the
dashboard makes blocking that `aide-run-spec` does not refuse on, and
`dashboardCheckout` has no `aide-run-spec` counterpart at all.

`DEPENDENCY_GATED_STEPS` is `implement` and `archive`, and "merged" means
ARCHIVED: a dependent spec's held-back steps are released when the
dependency's `archive` step runs. The dashboard's copy decides whether a
queued job is PARKED (left `queued` with the reason on its row); the
script's copy decides whether a run started by hand is REFUSED.

## Landing

`docs/landing.md`, and `docs/job-states.md` for the job's side of it.

- **No step's work is merged by hand.** `landBranch` in
  `dashboard/src/serve/land-branch/merge.ts` is the one place a branch
  lands, under `mergeLock` per repo root. There is no Merge or Approve
  button, no `gateAfter`, no `awaiting-approval` state.
- **An `onLanded` callback runs before its own job's `landing` flag is
  cleared**, so it cannot trust that one row's flag and must treat it as
  settled by hand — `docs/job-states.md`, "Beside the state".
- **Origin decides whether an `archive` landing finished.** It asks
  whether `aide/<folder>` is still on origin, and a root that holds it is
  a landing that did not finish. The check is `archive`'s alone, by the
  literal step name; a failed landing moves the job to `failed` and ONLY
  from `done`; an unanswerable `ls-remote` is `null` and claims nothing;
  the "not landed" row is filtered on the BRANCH, never on `errorReason`.
- **`codeLanding: pr` keeps the CODE root's branch open** on an `archive`
  landing and runs every step with `--push pr`; the two halves are never
  separated. The manifest is a DEFAULT for `--push`, never an override;
  the specs root keeps auto-merging; `errorReason` has no member for it —
  `prOpen`/`PR_OPEN` split the wording instead.

## Archive

`docs/landing.md`, "Archive resolves the conflict itself".

- **A conflict is `archive`'s to resolve, by the literal string
  `archive`, never a denylist.** `update_branch_to_base()` hands it the
  worktree with the merge OPEN; every other step aborts and refuses.
  `aide-run-spec` aborts an unfinished merge before its generic commit
  loop, for `archive` only, so conflict markers are never committed. The
  project's own test command is the gate: a resolution that fails it puts
  the branch back, and nothing lands.
- **`core/scripts/aide-archive-spec` decides and moves; the skill keeps
  only conflict resolution and doc feedback.** It runs twice in one step
  by design, and `already-archived` is the idempotent second answer.
- **A re-run of `archive` finds a folder that has moved:** `aide-run-spec`
  resolves `--spec` against the active folder first and `archive/` second,
  gated on the branch still being on origin.
