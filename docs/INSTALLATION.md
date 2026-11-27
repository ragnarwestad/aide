# Installation - Aide

## Table of contents

- [What you need first](#what-you-need-first)
- [Install](#install)
- [What every installer puts in place](#what-every-installer-puts-in-place)
- [Files you already have](#files-you-already-have)
- [Check the install](#check-the-install)
- [Where a spec's steps run](#where-a-specs-steps-run)
- [Update and uninstall](#update-and-uninstall)
- [Troubleshooting](#troubleshooting)
- [Adding another AI tool](#adding-another-ai-tool)

---

For a person installing Aide on a machine for one or more AI CLIs, or checking that an install worked. This page
holds what every installer does. What each CLI gets on top of that is on its own page:
[Claude Code](../core/implementations/claude-code/INSTALL.md),
[GitHub Copilot](../core/implementations/copilot/INSTALL.md),
[Codex](../core/implementations/codex/README.md) and
[OpenCode](../core/implementations/opencode/README.md).

## What you need first

The installers install none of these. A missing mise, node or AI CLI is reported with the command that installs it,
and the install carries on with what it can do without it.

- **Git.**
- **[mise](https://mise.jdx.dev) with a node.** The installers put the shared tools in place through it; without it
  they are skipped with a warning, and `jq`, which every spec script needs, may be missing.

  ```bash
  curl https://mise.run | sh   # mise's own installer prints the line to add to your shell's startup file
  mise use -g node@lts
  ```

- **The CLI of each AI tool you will use, on PATH, and signed in.** Aide's files install for all four whether or
  not the CLI is there, and take effect once it is.

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash   # Claude Code; the other three have their own installers
  ```

- **macOS or Linux.** On Windows, everything runs inside
  [WSL](https://learn.microsoft.com/en-us/windows/wsl/install).

---

## Install

Everything goes in your home directory; nothing is installed into the projects you use Aide on. A project's own
settings live in its `.aide/config` and `.aide/project.yaml`, listed in [CONFIGURATION.md](CONFIGURATION.md).

```bash
git clone https://github.com/ragnarwestad/aide.git ~/develop/aide
cd ~/develop/aide
./install-all.sh
```

`./install-all.sh` runs every tool's installer in turn and asks nothing: Codex's two optional MCP servers are
answered no. In Claude Code started in the Aide checkout, `/install-all` does the same.

For one tool only, or to be asked the Codex questions, run that tool's installer on its own:

```bash
core/implementations/claude-code/install.sh
core/implementations/copilot/install.sh
core/implementations/codex/install.sh
core/implementations/opencode/install.sh
```

Open a new terminal afterwards: the installer puts `~/.local/bin` on PATH through your shell's startup files.

---

## What every installer puts in place

1. **Runs `aide-preflight`**, which reports what is there before anything is written (see
   [Check the install](#check-the-install)).
2. **Installs every script in `core/scripts/` to `~/.local/bin/`** — `aide`, `aide-preflight`, `aide-generate-pdf`,
   `upgrade-ai-tools` and the rest — and everything under `core/scripts/lib/` to `~/.local/bin/lib/`. That includes
   the command rules (`lib/command-rules/`) and the instructions for a spec's steps (`lib/steps/`).
3. **Declares the shared tools through mise:** markdownlint-cli2, jq, gh, bun, pandoc, md-to-pdf and yt-dlp, which
   `upgrade-ai-tools` keeps current, and srt, the sandbox a Codex or OpenCode step runs in, at a fixed version it
   leaves alone.
4. **Puts `~/.local/bin` on PATH** in a marked block in `~/.zshenv` and `~/.bashrc`, so a non-interactive shell
   (ssh, launchd) finds the scripts too.
5. **Installs the tool's own part** — rules, skills, hooks — described on the tool's page, then checks PATH and
   that the tool's CLI is installed.

The installer records what it writes to `~/.local/bin/` in `~/.local/bin/.aide-installed-manifest`. The next install
removes a recorded file that Aide no longer has. A file the installer did not write stays, even if its name starts
with `aide-`.

---

## Files you already have

Every install writes to your home directory only, and keeps what you already have there:

- The global instructions for Copilot, Codex and OpenCode get Aide's rules in a block between two `aide rules`
  markers. Your own text outside the block is kept, a new install replaces only the block, and an uninstall removes
  only the block. A file that holds nothing but an earlier install's copy of the rules is replaced.
- Codex's `~/.codex/hooks.json` and Claude Code's `~/.claude/settings.json` get Aide's hooks beside your own hooks
  and settings; an uninstall takes out Aide's alone. The merge needs `jq`, and without it, or when the file is not
  valid JSON, a file of your own is left as it is.
- Skills and rules are installed by name, so yours with other names stay. A skill or rule with the same name as one
  of Aide's is replaced.
- OpenCode's `~/.config/opencode/opencode.json` gets `"CLAUDE.md"` added to its `instructions`; the rest of the file
  is kept, and an uninstall takes out only that entry. A config with comments (`opencode.jsonc`) is left alone.
- Folders of your own under `~/.claude/`, such as `commands/`, are not touched.

---

## Check the install

**`aide-preflight`** reports, for each AI tool, whether its CLI is on PATH, with its version, and where each Aide
piece lands: the skills, the rules, the hooks and the shared scripts. It only reports. For Claude Code it also warns
when git on the machine does not ignore `.claude/settings.local.json` in every repo, and when the repo it is run from
tracks that file; Claude Code keeps one person's settings there.

```bash
aide-preflight                 # every tool
aide-preflight codex           # one tool: claude, copilot, codex or opencode
aide-preflight --facts codex   # what the board reads: one tab-separated fact per line
```

The places it prints come from one table, `core/scripts/lib/install-targets.txt`.

**`aide --help`** prints the `aide` command's usage, which shows that the scripts are on PATH.

**On the board**, each provider's page under **Providers** in the "…" menu has an **Installation** tab. It lists the same places and,
below them, what is wrong on the machine the board runs on: a place that is missing, installed files behind the
repository, or a command line that is not found. For the first two it advises pressing **Deploy**.

**In a session**, each tool's page says how to see that the tool has Aide's skills.

---

## Where a spec's steps run

Create, analyze, implement, archive, close and reopen are not skills, and no AI session offers them as slash
commands. Their instructions are installed in `~/.local/bin/lib/steps/` and run only on the board. An install
removes the copies of them an earlier install put among the skills.

A person starts a step from the board, or from a terminal or an AI session with `aide`:

```bash
aide create my-app "Move the forms off Redux Form" < description.md
aide analyze 55
```

`aide` needs the board's address, `AIDE_BOARD_URL` in `~/.aide/config`. Without it, `aide` queues nothing and says
so. [Queueing from a terminal](../dashboard/docs/running-specs.md#queueing-from-a-terminal) has every command, and
[the dashboard's README](../dashboard/README.md#installation) says how to install the board.

---

## Update and uninstall

```bash
cd ~/develop/aide && git pull
./install-all.sh    # or the one tool's installer
```

An install replaces what it installed before and removes what Aide no longer ships. A tool reads its rules and skills
when a session starts, so start a new session afterwards.

`./uninstall-all.sh` (or `/uninstall-all` in Claude Code) reverses everything; each installer asks for its own
confirmation. A tool's own `uninstall.sh` removes that tool's part and leaves the shared scripts in `~/.local/bin/`
and the skills in `~/.agents/skills/`, which the other tools use.

---

## Troubleshooting

| What you see                                                        | What to do                                                                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/aide-create` or another step is not found                         | Expected: start the step from the board or with `aide` ([Where a spec's steps run](#where-a-specs-steps-run))                      |
| The AI tool does not follow Aide's rules                            | Run the tool's installer again, check with `aide-preflight <tool>`, and start a new session                                        |
| A `[aide tools]` warning during install                             | mise, its node or one of the shared tools is missing: install what the warning names, then run the installer again                 |
| `aide` says no board is set, or the board does not know the project | Set `AIDE_BOARD_URL` in `~/.aide/config`, or add the project on the board                                                          |
| `command not found` for an `aide-*` script                          | Open a new terminal, so the PATH block in `~/.zshenv` or `~/.bashrc` is read                                                       |

---

## Adding another AI tool

1. Add one row to `core/scripts/lib/ai-tools/tools.txt`.
2. Add its destinations to `core/scripts/lib/install-targets.txt`.
3. Create `core/implementations/<tool>/` with an `install.sh` and an `uninstall.sh`.
4. Call the shared steps in `core/scripts/_install-steps.sh` from its installer.
