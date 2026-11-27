# Claude Code implementation

## Table of contents

- [Files in this folder](#files-in-this-folder)
- [The command rules](#the-command-rules)
- [The settings template](#the-settings-template)
- [Denying direct edits of spec files](#denying-direct-edits-of-spec-files)

---

For a person looking up what Aide sets up in Claude Code's `~/.claude/settings.json`, and what it leaves to them.
Installing is in [INSTALL.md](INSTALL.md).

## Files in this folder

| File                         | What it is                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `install.sh`, `uninstall.sh` | Install and remove Aide for Claude Code ([INSTALL.md](INSTALL.md))                   |
| `hooks.json`                 | The two command-rule hooks the installer merges into `~/.claude/settings.json`       |
| `settings.json`              | A template for the rest of `~/.claude/settings.json`; the installer does not copy it |

---

## The command rules

Two hooks refuse a shell command before it runs: `git add .` or `git add -A`, and a test runner started in watch
mode. Each rule is one script in `core/scripts/lib/command-rules/`, installed to `~/.local/bin/lib/command-rules/`,
and Codex runs the same scripts.

The installer merges the two hook entries into `~/.claude/settings.json` and leaves every other key and hook there
as it is; an inline copy of the rules from an earlier `settings.json` template is replaced. The merge rewrites the
file through `jq`, so its indentation and key order may change. A file that is not valid JSON is left alone with a
warning. `./uninstall.sh` takes the two entries out again.

---

## The settings template

`settings.json` in this folder holds what Aide does not write into your settings, for you to copy by hand:

- a `PostToolUse` hook that runs `markdownlint-cli2` on a markdown file right after it is edited;
- a `Stop` hook that refuses to end a turn where source code changed and no tests or type checks ran;
- permissions that allow reading and editing under `~/develop/` and running shell commands without asking.

---

## Denying direct edits of spec files

Aide's scripts write a spec's files; the `Write` and `Edit` tools never need to. A deny rule for the project's
specs root therefore breaks nothing. The specs root is personal (`AIDE_SPECS_PATH` in the project's `.aide/config`),
so the installer cannot write that rule for you. Run this from inside the project:

```bash
aide-print-specs-guard
```

It prints two `deny` entries scoped to that project's specs root, to paste into the `"permissions": { "deny": [...] }`
array of `~/.claude/settings.json`.
