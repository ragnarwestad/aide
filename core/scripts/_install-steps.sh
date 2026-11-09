#!/usr/bin/env bash

_INSTALL_STEPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$_INSTALL_STEPS_DIR/../.." && pwd)"
source "$_INSTALL_STEPS_DIR/_install-bin.sh"
source "$_INSTALL_STEPS_DIR/_install-skills.sh"
source "$_INSTALL_STEPS_DIR/lib/ai-tools/read.sh"

install_steps_begin() {
  local id="$1" name
  name="$(ai_tool_field "$id" name)" || return 1
  echo "🔧 $name Setup"
  echo "====================="
  echo ""
  echo "📂 Workspace: $WORKSPACE_ROOT"
  echo ""
  AIDE_INSTALLING=1 "$WORKSPACE_ROOT/core/scripts/aide-preflight" "$id"
  echo "1️⃣  Installing scripts to ~/.local/bin/..."
  install_common_bin
  install_mise_declared_tools
  install_shell_path
  echo ""
}

install_instructions() {
  local destination="$1"
  if [ ! -f "$WORKSPACE_ROOT/core/AGENTS.md" ]; then
    echo "   ❌ core/AGENTS.md not found!"
    echo "   Run core/scripts/build-agents-md.sh first, or make sure you have the latest version: git pull"
    return 1
  fi
  mkdir -p "$(dirname "$destination")"
  cp "$WORKSPACE_ROOT/core/AGENTS.md" "$destination"
  echo "   ✅ Installed: ${destination/#$HOME/\~}"
}

install_steps_finish() {
  local id="$1" cli install path_step cli_step version
  cli="$(ai_tool_field "$id" cli)" || return 1
  install="$(ai_tool_field "$id" install)" || return 1
  case "$id" in
    claude) path_step=3; cli_step=3 ;;
    copilot) path_step=4; cli_step=5 ;;
    codex) path_step=5; cli_step=6 ;;
    opencode) path_step=4; cli_step=5 ;;
  esac
  echo "${path_step}️⃣  Verifying PATH..."
  if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
    echo "   ✅ ~/.local/bin is in PATH"
  else
    echo "   ⚠️  ~/.local/bin is NOT in PATH for this shell yet"
    echo "   ℹ️  It was just added to ~/.zshenv and ~/.bashrc — open a new"
    echo "      terminal or ssh session to pick it up"
  fi
  [ "$id" = "claude" ] && return 0
  echo "${cli_step}️⃣  Checking $(ai_tool_field "$id" name)..."
  if command -v "$cli" >/dev/null 2>&1; then
    version="$($cli --version 2>/dev/null | head -1 || echo 'version unknown')"
    echo "   ✅ $(ai_tool_field "$id" name) is installed: $version"
  else
    echo "   ⚠️  $(ai_tool_field "$id" name) is NOT installed"
    echo ""
    echo "   Install:"
    echo "      $install"
    echo ""
  fi
}
