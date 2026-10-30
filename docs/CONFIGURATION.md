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

| File                 | Committed | Holds                                                                     |
|----------------------|-----------|---------------------------------------------------------------------------|
| `.aide/config`       | never     | What belongs to one machine: where the specs are, how to install here     |
| `.aide/project.yaml` | yes       | What is true of the project on every machine: its test command, its links |
| `~/.aide/config`     | never     | What belongs to the machine for every project: where the board is         |

`.aide/config` is plain `KEY=value` lines with `#` comments, and is gitignored: it is lost the moment the project
meets a new machine, so nothing the project needs everywhere belongs in it. `.aide/project.yaml`, the manifest, is
YAML and travels with the repository. A project that tracks no manifest has its manifest keys kept by the dashboard
instead, in `settings.yaml` beside its checkouts, which a run sees as an untracked `.aide/project.yaml`; a tracked
manifest always wins.

No project setting is read from both of its files. A key written in the other file is not read at all.

---

## .aide/config

| Key                | What it says                                                                                            | Read by                      | In Config |
|--------------------|---------------------------------------------------------------------------------------------------------|------------------------------|-----------|
| `AIDE_SPECS_PATH`  | Where this project's specs are kept, when not in its own `specs/`                                       | the skills, a run, the board | yes       |
| `AIDE_INSTALL_CMD` | What installing the project means on this machine, run by the board after the project's code has merged | the board                    | yes       |
| `AIDE_LINT_CMD`    | The lint command, when the one worked out from the project's files is wrong                             | the AI in `/aide-implement`  | no        |
| `AIDE_BUILD_CMD`   | The build command, likewise                                                                             | the AI in `/aide-implement`  | no        |
| `AIDE_CLAUDE_BIN`  | A stand-in for `claude`, for a test board that runs no real model                                       | a run                        | no        |

`.aide/config.example` in this repository names each key with an example value.

---

## ~/.aide/config, one per machine

The same `KEY=value` format as `.aide/config`, in the home directory, so one file serves every project on the
machine. It is never committed.

| Key              | What it says                                                                                                                                                                                                                                                      | Read by           |
|------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------|
| `AIDE_BOARD_URL` | The board's address as this machine reaches it, such as `https://<serving-host>.<tailnet>.ts.net` ([dashboard/docs/tailscale.md](../dashboard/docs/tailscale.md)). Without it `aide-push-specs` pushes and tells nobody, and Aide works as before without a board | `aide-push-specs` |

---

## .aide/project.yaml

The settings a run uses:

| Key                      | What it says                                                                                                                                                                                                                                                                                  | Read by                       | In Config |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------|-----------|
| `AIDE_TEST_CMD`          | The project's test command: the whole suite, run by implement, by the landing and by `/aide-implement` alike. Never guessed: without it no tests run                                                                                                                                          | a run, the landing, the board | yes       |
| `acPrefix`               | What implement puts before a criterion's id in a test's name; `{spec}` stands for the spec's number as its folder writes it, so `acPrefix: "F{spec}"` names the test for spec 02's AC-2 `(F02 AC-2)`. Absent means `(AC-2)`. Read from `.aide/project.yaml` in the checkout implement runs in | implement, the board          | yes       |
| `worktreeLinks`          | Gitignored paths a run symlinks into its worktree, such as `node_modules` or `.venv`                                                                                                                                                                                                          | a run, the landing, the board | yes       |
| `previewCmd`             | How to start the project for a look at one branch; it serves on `$PORT`                                                                                                                                                                                                                       | the board's test server       | yes       |
| `deployment.previewFrom` | How one branch can be tried before it is merged: `cloudflare-pages` (the host builds every branch; the row links to its address), `command` (the board starts the project, with `previewCmd`) or `none`; absent means `none`                                                                  | the board                     | yes       |
| `codeLanding`            | `pr` to leave archived code on its branch for a pull request; absent means merge into the default branch                                                                                                                                                                                      | a run, the board              | yes       |
| `description`            | One line saying what the project is, shown on the Projects list                                                                                                                                                                                                                               | the board                     | yes       |
| `name`                   | The project's name                                                                                                                                                                                                                                                                            | a run, the board              | no        |

---

## Setting them from the dashboard

The Config tab on a project's page shows one table per file, each with its own Edit, Save and Cancel. Edit turns
that table alone into a form, and the other table's Edit is disabled until it is saved or cancelled. Save writes the
table's values to its own file and leaves the other file untouched: `.aide/config` stays on the machine, while a
manifest value is committed and pushed where the project tracks its manifest, or written to the dashboard's
`settings.yaml` where it does not.
[dashboard/docs/projects.md](../dashboard/docs/projects.md) describes the tab.
