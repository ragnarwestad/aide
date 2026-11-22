#!/usr/bin/env bash
# _claude-md.sh - Let OpenCode read a project's CLAUDE.md.
# Sourced by core/implementations/opencode/install.sh and uninstall.sh.
#
# OpenCode 2 reads only AGENTS.md as a project's instructions. A relative path
# in the global config's `instructions` is searched from the working directory
# up to the project root too, so "CLAUDE.md" there gives OpenCode a project's
# CLAUDE.md. It is read beside AGENTS.md where a project has both: OpenCode has
# no setting that reads a file only where AGENTS.md is missing.
#
# The installer records what it did in a file beside the config, so the
# uninstaller takes back only its own entry.

_AIDE_OPENCODE_CLAUDE_MD_MARK=".aide-claude-md"

# install_opencode_claude_md <opencode config dir>
install_opencode_claude_md() {
  local dir="$1" config="$1/opencode.json" mark="$1/$_AIDE_OPENCODE_CLAUDE_MD_MARK" updated
  mkdir -p "$dir"
  if [ ! -f "$config" ] && [ -f "$dir/opencode.jsonc" ]; then
    echo "   ⚠️  $dir/opencode.jsonc may hold comments, which jq cannot keep; left as it is."
    echo "      Add \"CLAUDE.md\" to its \"instructions\" for OpenCode to read a project's CLAUDE.md"
    return 0
  fi
  if [ ! -f "$config" ]; then
    printf '{\n  "$schema": "https://opencode.ai/config.json",\n  "instructions": ["CLAUDE.md"]\n}\n' > "$config"
    echo "created" > "$mark"
    echo "   ✅ OpenCode reads a project's CLAUDE.md ($config)"
    return 0
  fi
  if ! command -v jq &> /dev/null; then
    echo "   ⚠️  Adding \"CLAUDE.md\" to $config needs jq; left as it is (brew install jq, then install again)"
    return 0
  fi
  if jq -e '(.instructions // []) | index("CLAUDE.md")' "$config" > /dev/null; then
    echo "   ✅ OpenCode already reads a project's CLAUDE.md"
    return 0
  fi
  updated="$(jq '.instructions = ((.instructions // []) + ["CLAUDE.md"])' "$config")"
  printf '%s\n' "$updated" > "$config"
  echo "added" > "$mark"
  echo "   ✅ OpenCode reads a project's CLAUDE.md (\"instructions\" in $config)"
}

# uninstall_opencode_claude_md <opencode config dir>
uninstall_opencode_claude_md() {
  local dir="$1" config="$1/opencode.json" mark="$1/$_AIDE_OPENCODE_CLAUDE_MD_MARK" how updated
  [ -f "$mark" ] || return 0
  how="$(cat "$mark")"
  rm "$mark"
  [ -f "$config" ] || return 0
  if ! command -v jq &> /dev/null; then
    echo "   ⚠️  Taking \"CLAUDE.md\" out of $config needs jq — left in place"
    return 0
  fi
  updated="$(jq '.instructions |= ((. // []) - ["CLAUDE.md"]) | if .instructions == [] then del(.instructions) else . end' "$config")"
  if [ "$how" = created ] && [ "$(jq '(keys - ["$schema"]) | length' <<< "$updated")" = 0 ]; then
    rm "$config"
    echo "   ✅ Removed: $config"
  else
    printf '%s\n' "$updated" > "$config"
    echo "   ✅ Removed \"CLAUDE.md\" from \"instructions\" in $config"
  fi
}
