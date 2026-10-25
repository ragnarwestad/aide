#!/usr/bin/env bash
# run-spec/setup/sandbox.sh — sourced by aide-run-spec before setup/invocation.sh.
#
# What a step may not reach. A step runs the AI tool as the user, so every
# command it runs and every file tool it calls could read and write the whole
# home directory. The AI tool's own sandbox narrows that to a fixed list the
# runner owns: the credentials on the serving host and the board's own
# secrets, denied for reading and writing alike. Everything else stays
# reachable, the network included, so a project's tests need no setting of
# their own. The runner's own commit, push and landing run outside it.
#
# Each entry is relative to $HOME and written as `~/…` in every rule: a rule
# that starts with a single `/` is read relative to the settings file, and
# denies nothing without saying so (verified on Claude Code 2.1.310).
sandbox_denied=(
  .ssh
  .gnupg
  .aws
  .config/gh
  .docker/config.json
  .netrc
  .npmrc
  .codex/auth.json
  .local/share/opencode/auth.json
  .aide-round-token
  .aide/replay-token
  .aide/dashboard/queue-token
  .aide/dashboard/push-key.json
  Library/Keychains
)

# What a step may read but not write: anything something outside the
# sandbox later runs or reads as settings. A login shell, launchd, the
# commands on PATH, git's own settings, the AI tools' settings, hooks and
# skills, and the board's queue settings, where a schedule entry may turn
# the sandbox off. Installing onto the serving host is the landing's job
# (`AIDE_INSTALL_CMD`), never a step's.
sandbox_write_denied=(
  .zshrc
  .zshenv
  .zprofile
  .zlogin
  .bashrc
  .bash_profile
  .profile
  Library/LaunchAgents
  .local/bin
  .local/share/mise
  .config/mise
  .gitconfig
  .config/git
  .claude.json
  .claude/settings.json
  .claude/settings.local.json
  .claude/hooks
  .claude/skills
  .claude/agents
  .claude/rules
  .claude/plugins
  .claude/CLAUDE.md
  .agents
  .codex
  .config/opencode
)

# The same for the files the runner and the board run git and the tests
# from, outside the sandbox: the board's queue settings, where a schedule
# entry may turn the sandbox off, every main checkout's hooks and git
# settings, and every dashboard checkout's settings.yaml, which holds the
# test command (denied whether it exists or not, so none can be made). The
# board hands over where its files are (AIDE_QUEUE_CONFIG,
# AIDE_CHECKOUT_ROOT). One path per line, written the way the rules read
# it: `~/…` under $HOME, `//…` anywhere else.
sandbox_runtime_write_denied() {
  local dir checkouts="${AIDE_CHECKOUT_ROOT:-$HOME/.aide/dashboard/checkouts}"
  printf '%s\n' "${AIDE_QUEUE_CONFIG:-$HOME/.aide/dashboard/queue-config.json}"
  for dir in "${project_root:-}" "${specs_repo:-}" "$checkouts"/*/code "$checkouts"/*/specs; do
    [ -n "$dir" ] && [ -d "$dir/.git" ] || continue
    printf '%s\n' "$dir/.git/hooks" "$dir/.git/config"
  done
  for dir in "$checkouts"/*/; do
    [ -d "$dir" ] && printf '%s\n' "${dir%/}/settings.yaml"
  done | sort -u
} 2>/dev/null
sandbox_rule_path() {
  # shellcheck disable=SC2088  # a literal `~/`, as above
  case "$1" in
    "$HOME"/*) printf '~/%s\n' "${1#"$HOME"/}" ;;
    *) printf '/%s\n' "$1" ;;
  esac
}

# Claude's `--settings` for every step, as one line of JSON. The sandbox
# confines shell commands only; the file tools (Read, Edit, Write) follow
# permission rules, and a `deny` rule wins over the user's own global `allow`
# of `Edit` and `Write`. An `Edit(...)` rule covers every tool that writes a
# file, and Claude Code ignores `Write(...)` for files, so none is written.
# `allowUnsandboxedCommands: false` keeps a command from asking its way out,
# and `autoAllowBashIfSandboxed` lets a sandboxed command run with nobody
# there to answer. The temporary directories are added because scripts and
# tests write `/tmp` and `$TMPDIR` (under `/private/var/folders`) directly,
# not only the sandbox's own temp directory, and `allowLocalBinding` lets a
# test start a server on localhost and reach it. Verified on Claude Code
# 2.1.310 in a worktree of Aide on the serving host.
#
# Codex gets none of this: its sandbox can confine writing but not reading,
# and `git` in a worktree, whose git directory lies in the main checkout,
# fails under `workspace-write` (codex-cli 0.164.0).
#
# Chromium cannot start in this sandbox: it registers a Mach service
# (`bootstrap_check_in`), and no sandbox setting allows that. Excluding the
# browser-test commands from the sandbox would let a step rewrite them into
# anything, so the step is told instead ($sandbox_note), and the runner's own
# test run after the step, outside the sandbox, runs the browser tests.
sandbox_settings_json() {
  local paths writes runtime path
  # shellcheck disable=SC2088  # a literal `~/`: the rules must say it, not $HOME
  paths="$(printf '~/%s\n' "${sandbox_denied[@]}" | jq -R . | jq -sc .)"
  runtime="$(sandbox_runtime_write_denied)"
  # shellcheck disable=SC2088
  writes="$({ printf '~/%s\n' "${sandbox_write_denied[@]}"
              while IFS= read -r path; do
                [ -n "$path" ] && sandbox_rule_path "$path"
              done <<< "$runtime"; } | jq -R . | jq -sc .)"
  jq -cn --argjson paths "$paths" --argjson writes "$writes" '{
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        allowWrite: ["~/", "/tmp", "/private/tmp", "/private/var/folders"],
        denyWrite: ($paths + $writes), denyRead: $paths
      },
      network: { allowLocalBinding: true }
    },
    permissions: {
      deny: ([ $paths[] | ("Read(" + . + ")", "Read(" + . + "/**)", "Edit(" + . + ")", "Edit(" + . + "/**)") ]
             + [ $writes[] | ("Edit(" + . + ")", "Edit(" + . + "/**)") ])
    }
  }'
}

# A worktree's `.git` file, and its git directory's `commondir` and
# `gitdir`, say where git finds its settings and hooks. A step that
# rewrote them could point the runner's own git, outside the sandbox, at
# hooks of its own, so they are kept as the worktree was cut and put back
# once every turn has ended, before the runner runs git there. Every tool
# gets this, the sandbox or not.
sandbox_git_links=()
sandbox_record_git_links() {
  local wt gitdir link
  sandbox_git_links=()
  for wt in "$@"; do
    [ -f "$wt/.git" ] || continue
    gitdir="$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)" || continue
    for link in "$wt/.git" "$gitdir/commondir" "$gitdir/gitdir"; do
      [ -f "$link" ] && sandbox_git_links+=("$link" "$(cat "$link")")
    done
  done
}
sandbox_restore_git_links() {
  local i=0 link want
  while [ "$i" -lt "${#sandbox_git_links[@]}" ]; do
    link="${sandbox_git_links[$i]}"; want="${sandbox_git_links[$((i + 1))]}"
    i=$((i + 2))
    [ -f "$link" ] && [ ! -L "$link" ] && [ "$(cat "$link")" = "$want" ] && continue
    rm -rf "$link" && printf '%s\n' "$want" > "$link"
    echo "aide-run-spec: the step rewrote $link; it is put back" >&2
  done
  return 0
}

# Told to every Claude step, in its prompt.
sandbox_note="Your shell commands run in a sandbox. A browser (Chromium, Playwright) cannot start in it, so do not run browser tests yourself: the runner runs the project's whole test command itself, outside the sandbox, before the work can land, and an implement step gets back anything that is red."
