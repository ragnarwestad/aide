# Configuration - Aide

## Table of contents

- [Three files](#three-files)
- [.aide/config](#aideconfig)
- [~/.aide/config, one per machine](#aideconfig-one-per-machine)
- [.aide/project.yaml](#aideprojectyaml)
- [Setting them from the dashboard](#setting-them-from-the-dashboard)

---

## Three files

A project tells Aide about itself in two files, and every setting lives in exactly one of them. A third file
belongs to the machine and is the same for every project.

| File                   | Committed   | Holds                                                                       |
| ---------------------- | ----------- | --------------------------------------------------------------------------- |
| `.aide/config`         | never       | What belongs to one machine: where the specs are, how to install here       |
| `.aide/project.yaml`   | yes         | What is true of the project on every machine: its test command, its links   |
| `~/.aide/config`       | never       | What belongs to the machine for every project: where the board is           |

`.aide/config` is plain `KEY=value` lines with `#` comments, and is gitignored: it is lost the moment the project
meets a new machine, so nothing the project needs everywhere belongs in it. `.aide/project.yaml`, the manifest, is
YAML and travels with the repository. A project that tracks no manifest has its manifest keys kept by the dashboard
instead, in `settings.yaml` beside its checkouts, which a run sees as an untracked `.aide/project.yaml`; a tracked
manifest always wins.

No project setting is read from both of its files. A key written in the other file is not read at all.

---

## .aide/config

| Key                  | What it says                                                                                              | Read by                        | In Config   |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- |
| `AIDE_SPECS_PATH`    | Where this project's specs are kept, when not in its own `specs/`                                         | the skills, a run, the board   | yes         |
| `AIDE_INSTALL_CMD`   | What installing the project means on this machine, run by the board after the project's code has merged   | the board                      | yes         |
| `AIDE_LINT_CMD`      | The lint command, when the one worked out from the project's files is wrong                               | the AI in the implement step   | no          |
| `AIDE_BUILD_CMD`     | The build command, likewise                                                                               | the AI in the implement step   | no          |
| `AIDE_CLAUDE_BIN`    | A stand-in for `claude`, for a test board that runs no real model                                         | a run                          | no          |

`.aide/config.example` in this repository names each key with an example value.

---

## ~/.aide/config, one per machine

The same `KEY=value` format as `.aide/config`, in the home directory, so one file serves every project on the
machine. It is never committed.

| Key                | What it says                                                                                                                                                                                                                                                                                                                                                                                            | Read by                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `AIDE_BOARD_URL`   | The board's address as this machine reaches it, such as `https://<serving-host>.<tailnet>.ts.net` ([dashboard/docs/tailscale.md](../dashboard/docs/tailscale.md)). `aide` queues every spec step there. Without it `aide` queues nothing and says so: a spec's steps run only on a board                                                                                                                | `aide`                                       |

---

## .aide/project.yaml

The settings a run uses:

| Key                      | What it says                                                                                                                                                                                                                                                                                  | Read by                     | In Config |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------- |
| `AIDE_TEST_CMD`          | The project's test command: the whole suite, run by implement and by the merge alike. Never guessed: without it no tests run                                                                                                                                                                  | a run, the merge, the board | yes       |
| `AIDE_TEST_CHANGED_CMD`  | Optional command for Implement, Merge and Archive, given the default branch as its final argument. It must select tests conservatively and fall back to the full suite when the change is unknown                                                                                             | a run                       | no        |
| `AIDE_TEST_FILES_CMD`    | The command for running named test files once. Implement appends each red file and uses the exit code to distinguish a persistent failure from a test that may be unstable. Never guessed                                                                                                     | a run                       | no        |
| `acPrefix`               | What implement puts before a criterion's id in a test's name; `{spec}` stands for the spec's number as its folder writes it, so `acPrefix: "F{spec}"` names the test for spec 02's AC-2 `(F02 AC-2)`. Absent means `(AC-2)`. Read from `.aide/project.yaml` in the checkout implement runs in | implement, the board        | yes       |
| `worktreeLinks`          | Gitignored paths a run symlinks into its worktree, such as `node_modules` or `.venv`                                                                                                                                                                                                          | a run, the merge, the board | yes       |
| `worktreeSetup`          | The command that installs a worktree's own dependencies, such as `pnpm install --frozen-lockfile`. It runs at the root of each step's worktree, the merge's and the test server's before anything else runs there; a failure stops that step, merge or test server. Take the dependency folders it installs out of `worktreeLinks` | a run, the merge, the board | yes       |
| `previewCmd`             | How to start the project for a look at one branch; it serves on `$PORT`                                                                                                                                                                                                                       | the board's test server     | yes       |
| `deployment.previewFrom` | How one branch can be tried before it is merged: `cloudflare-pages` (the host builds every branch; the row links to its address), `command` (the board starts the project, with `previewCmd`) or `none`; absent means `none`                                                                  | the board                   | yes       |
| `codeLanding`            | `pr` to leave archived code on its branch for a pull request; absent means merge into the default branch                                                                                                                                                                                      | a run, the board            | yes       |
| `translationFiles`       | The project's translation files as space-separated patterns, such as `packages/i18n/messages/*.json`. Two specs adding messages to one of them merge key by key instead of conflicting, and Analyze never counts one as a file two specs share                                                | a run, the merge            | no        |
| `description`            | One line saying what the project is, shown on the Projects list                                                                                                                                                                                                                               | the board                   | yes       |
| `icon`                   | A path from the repository's root to an image file the default branch tracks (SVG, PNG, ICO, JPEG, WebP or GIF), shown as the project's icon. Absent: the tracked favicon nearest the root, else the name's initials                                                                          | the board                   | yes       |
| `name`                   | The project's name                                                                                                                                                                                                                                                                            | a run, the board            | no        |

---

## Setting them from the dashboard

The Config tab on a project's page shows one card per file, each its own form with Save and Cancel, and every field
editable as the tab opens. Save writes the card's values to its own file and leaves the other file untouched: `.aide/config` stays on the machine, while a
manifest value is committed and pushed where the project tracks its manifest, or written to the dashboard's
`settings.yaml` where it does not.
[dashboard/docs/projects.md](../dashboard/docs/projects.md) describes the tab.
