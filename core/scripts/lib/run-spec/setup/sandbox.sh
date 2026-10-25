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
  local paths
  # shellcheck disable=SC2088  # a literal `~/`: the rules must say it, not $HOME
  paths="$(printf '~/%s\n' "${sandbox_denied[@]}" | jq -R . | jq -sc .)"
  jq -cn --argjson paths "$paths" '{
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        allowWrite: ["~/", "/tmp", "/private/tmp", "/private/var/folders"],
        denyWrite: $paths, denyRead: $paths
      },
      network: { allowLocalBinding: true }
    },
    permissions: {
      deny: [ $paths[] | ("Read(" + . + ")", "Read(" + . + "/**)", "Edit(" + . + ")", "Edit(" + . + "/**)") ]
    }
  }'
}

# Told to every Claude step, in its prompt.
sandbox_note="Your shell commands run in a sandbox. A browser (Chromium, Playwright) cannot start in it, so do not run browser tests yourself: the runner runs the project's whole test command itself, outside the sandbox, before the work can land, and an implement step gets back anything that is red."
