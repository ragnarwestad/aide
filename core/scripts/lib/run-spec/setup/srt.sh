#!/usr/bin/env bash
# run-spec/setup/srt.sh — the sandbox a Codex or OpenCode turn runs in.
#
# Claude runs its own sandbox around its shell commands (setup/sandbox.sh).
# Codex and OpenCode are started inside srt instead (`@anthropic-ai/
# sandbox-runtime`, the engine of Claude's own sandbox), with the same
# lists of what a step may not read and not write. srt confines the whole
# tool, not only its commands, so the tool's own login stays readable:
# `auth.json` in the active Codex folder for Codex, OpenCode's own for
# OpenCode. Codex's own sandbox cannot start inside srt (macOS refuses a
# second sandbox, and every command then fails while Codex still exits 0),
# so Codex always runs with its own sandbox off and srt sets what the
# permission mode allows it to write. Verified with srt 0.0.83, codex-cli
# and OpenCode 2.3.2 on the serving host, 2026-11-23.

# The version the installer declares (`_install-bin.sh`). srt refuses a
# settings file its schema does not accept, so it is not upgraded blindly.
SRT_PACKAGE="npm:@anthropic-ai/sandbox-runtime@0.0.83"

# Where a turn may connect: srt denies every other host, and it takes no
# wildcard broader than one domain. Every turn reaches the AI providers; a
# turn that may write also reaches GitHub and the package registries a
# project's own install and tests fetch from; a scheduled job also reaches
# the sites the news check reads (the Sources, Watched pages and YouTube
# channels in docs/AI_NEWS_LOG.md, and the X and YouTube readers in
# scripts/news/).
srt_provider_domains=(
  anthropic.com '*.anthropic.com'
  openai.com '*.openai.com' chatgpt.com '*.chatgpt.com'
  opencode.ai '*.opencode.ai' models.dev openrouter.ai '*.openrouter.ai'
)
srt_fetch_domains=(
  github.com '*.github.com' '*.githubusercontent.com'
  registry.npmjs.org pypi.org files.pythonhosted.org
)
srt_schedule_domains=(
  claude.com '*.claude.com' claude.ai '*.claude.ai' claude.dev '*.claude.dev'
  github.blog '*.github.io' agents.md agentskills.io aaif.io modelcontextprotocol.io '*.modelcontextprotocol.io'
  artificialanalysis.ai '*.artificialanalysis.ai' martinfowler.com arxiv.org '*.arxiv.org' learn.microsoft.com
  x.com '*.x.com' twitter.com '*.twitter.com' fxtwitter.com '*.fxtwitter.com'
  youtube.com '*.youtube.com' youtu.be '*.googlevideo.com' '*.ytimg.com'
)

# The Codex folder this turn logs in from: the one entry under it a turn
# may write in (its sessions and databases), apart from what it runs.
srt_codex_home() { printf '%s\n' "${CODEX_HOME:-$HOME/.codex}"; }

# What Codex reads from its folder as settings, instructions or code it
# runs: denied for writing, as `~/.codex` is whole for a Claude step.
srt_codex_settings=(AGENTS.md AGENTS.override.md instructions.md config.toml config.json .env hooks
  hooks.json rules skills plugins packages prompts memories)

# What OpenCode runs from its own state folders, also outside the sandbox
# when a person uses it: denied for writing.
srt_opencode_code=("$HOME/.cache/opencode/bin" "$HOME/.cache/opencode/node_modules"
  "$HOME/.cache/opencode/package.json" "$HOME/.cache/opencode/bun.lock" "$HOME/.cache/opencode/bun.lockb")

# A path the way srt reads it: `~/…` under $HOME, absolute anywhere else.
srt_rule_path() {
  # shellcheck disable=SC2088  # a literal `~/`: srt expands it
  case "$1" in
    "$HOME"/*) printf '~/%s\n' "${1#"$HOME"/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

# The paths <tool> logs in with, which its turn must read (and may renew),
# one per line. srt follows a link, so a replay's Codex folder, whose
# `auth.json` links to the one in `~/.codex`, is also given that file. Only
# a replay's: a turn may write its own Codex folder, so a link found in
# `~/.codex` or in a folder of the board's Codex accounts is not followed,
# and no other target ever is.
srt_own_login() {  # <tool>
  local home real dir
  case "$1" in
    codex)
      home="$(srt_codex_home)"
      srt_rule_path "${home%/}/auth.json"
      [ -L "$home/auth.json" ] && [ "$(readlink "$home/auth.json")" = "$HOME/.codex/auth.json" ] || return 0
      real="$(srt_physical_dir "$home")" || return 0
      while IFS= read -r dir; do
        [ -n "$dir" ] && [ "$(srt_physical_dir "$dir" || printf '%s' "${dir%/}")" = "$real" ] && return 0
      done <<< "$HOME/.codex
${AIDE_CODEX_HOMES:-}"
      srt_rule_path "$HOME/.codex/auth.json" ;;
    opencode) srt_rule_path "$HOME/.local/share/opencode/auth.json" ;;
  esac
}

# <dir> as the folder it is on disk, links and trailing slashes resolved;
# fails when it cannot be resolved.
srt_physical_dir() { (cd -P -- "$1" 2>/dev/null && pwd -P); }

# The folders <tool> keeps its own sessions and state in.
srt_own_state() {  # <tool>
  case "$1" in
    codex) srt_rule_path "$(srt_codex_home)" ;;
    opencode)
      srt_rule_path "$HOME/.local/share/opencode"
      srt_rule_path "$HOME/.local/state/opencode"
      srt_rule_path "$HOME/.cache/opencode" ;;
  esac
}

# srt's settings for one turn of <tool> in <permission-mode>, as one line of
# JSON. <settings-file> is where the runner writes them, denied for writing
# so no turn rewrites the next one's. The remaining arguments are the
# folders an `acceptEdits` turn may write: its worktree and the others it
# was given.
# shellcheck disable=SC2088  # a literal `~/` throughout: srt expands it
srt_settings_json() {  # <tool> <permission-mode> <settings-file> [<writable-dir>...]
  local tool_name="$1" mode="$2" file="$3" path login state codex_home
  shift 3
  login="$(srt_own_login "$tool_name")"
  codex_home="$(srt_rule_path "$(srt_codex_home)")"
  local -a reads=() writes=() allow=(/tmp /private/tmp /private/var/folders) domains=("${srt_provider_domains[@]}")
  while IFS= read -r path; do
    [ -n "$path" ] && ! grep -qxF -- "$path" <<< "$login" && reads+=("$path")
  done <<< "$(printf '~/%s\n' "${sandbox_denied[@]}"
              while IFS= read -r path; do
                [ -n "$path" ] && srt_rule_path "$path"
              done <<< "$(sandbox_runtime_read_denied)")"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    [ "$tool_name" = "codex" ] && [ "$path" = "$codex_home" ] && continue
    writes+=("$path")
  done <<< "$(printf '~/%s\n' "${sandbox_write_denied[@]}"
              while IFS= read -r path; do
                [ -n "$path" ] && srt_rule_path "$path"
              done <<< "$(sandbox_runtime_write_denied)")"
  if [ "$tool_name" = "codex" ]; then
    for path in "${srt_codex_settings[@]}"; do writes+=("$codex_home/$path"); done
  elif [ "$tool_name" = "opencode" ]; then
    for path in "${srt_opencode_code[@]}"; do writes+=("$(srt_rule_path "$path")"); done
  fi
  writes+=("$(srt_rule_path "$file")")
  case "$mode" in
    bypassPermissions) allow+=("~/"); domains+=("${srt_fetch_domains[@]}") ;;
    acceptEdits) for path in "$@"; do [ -n "$path" ] && allow+=("$(srt_rule_path "$path")"); done
                 domains+=("${srt_fetch_domains[@]}") ;;
  esac
  [ "${command_name:-}" = "schedule" ] && domains+=("${srt_schedule_domains[@]}")
  while IFS= read -r state; do [ -n "$state" ] && allow+=("$state"); done <<< "$(srt_own_state "$tool_name")"
  jq -cn --arg tool "$tool_name" \
    --argjson reads "$(printf '%s\n' "${reads[@]}" | jq -R . | jq -sc .)" \
    --argjson writes "$(printf '%s\n' "${writes[@]}" | jq -R . | jq -sc .)" \
    --argjson allow "$(printf '%s\n' "${allow[@]}" | jq -R . | jq -sc .)" \
    --argjson domains "$(printf '%s\n' "${domains[@]}" | jq -R . | jq -sc .)" '{
      network: {allowedDomains: $domains, deniedDomains: [], allowLocalBinding: true},
      filesystem: {denyRead: $reads, allowWrite: $allow, denyWrite: ($reads + $writes)}
    }
    # Codex checks a certificate through macOS (trustd), which srt shuts
    # off unless asked; without it no request of Codex gets through.
    + (if $tool == "codex" then {enableWeakerNetworkIsolation: true} else {} end)'
}
