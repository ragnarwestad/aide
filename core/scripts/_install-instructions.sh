#!/usr/bin/env bash
# _install-instructions.sh - aide's rules in a global instruction file, beside
# what the user wrote there. Sourced by _install-steps.sh and the uninstallers.
#
# Copilot, Codex and OpenCode each read one global instruction file
# (core/scripts/lib/install-targets.txt names them). aide's rules,
# core/AGENTS.md, go in a block between two markers; an install replaces only
# that block and an uninstall removes only that block.

_AIDE_INSTRUCTIONS_START="<!-- >>> aide rules (managed by aide, do not edit by hand) >>> -->"
_AIDE_INSTRUCTIONS_END="<!-- <<< aide rules <<< -->"

# The first line of every core/AGENTS.md earlier installs copied whole, with
# no markers: such a file is aide's own and is replaced, not kept as the user's.
_AIDE_INSTRUCTIONS_OLD_COPY='^# (Doc )?[Aa]ide — (Shared instructions|Felles instruksjoner)$'

_aide_remove_instructions_block() {
  local file="$1"
  grep -qxF "$_AIDE_INSTRUCTIONS_START" "$file" || return 0
  awk -v start="$_AIDE_INSTRUCTIONS_START" -v end="$_AIDE_INSTRUCTIONS_END" '
    $0 == start { skip = 1 }
    skip == 0 { print }
    $0 == end { skip = 0 }
  ' "$file" > "$file.aide-tmp" && mv "$file.aide-tmp" "$file"
}

# install_instructions <destination>
install_instructions() {
  local destination="$1"
  local source="${AIDE_INSTRUCTIONS_SOURCE:-$WORKSPACE_ROOT/core/AGENTS.md}"
  if [ ! -f "$source" ]; then
    echo "   ❌ core/AGENTS.md not found!"
    echo "   Run core/scripts/build-agents-md.sh first, or make sure you have the latest version: git pull"
    return 1
  fi
  mkdir -p "$(dirname "$destination")"
  if [ -f "$destination" ] && ! grep -qxF "$_AIDE_INSTRUCTIONS_START" "$destination" \
    && head -n 1 "$destination" | grep -qE "$_AIDE_INSTRUCTIONS_OLD_COPY"; then
    rm "$destination"
  fi
  touch "$destination"
  _aide_remove_instructions_block "$destination"
  # A last line without a newline would be glued onto the block's first.
  if [ -s "$destination" ] && [ -n "$(tail -c1 "$destination")" ]; then
    echo >> "$destination"
  fi
  { echo "$_AIDE_INSTRUCTIONS_START"; cat "$source"; echo "$_AIDE_INSTRUCTIONS_END"; } >> "$destination"
  echo "   ✅ Installed: ${destination/#$HOME/\~} (aide's rules in a marked block; your own text is kept)"
}

# uninstall_instructions <destination>
#
# Removes the block; a file left with nothing but blank lines is removed too.
uninstall_instructions() {
  local destination="$1"
  if [ ! -f "$destination" ]; then
    echo "   ⏭️  Did not exist: ${destination/#$HOME/\~}"
    return 0
  fi
  _aide_remove_instructions_block "$destination"
  if grep -q '[^[:space:]]' "$destination"; then
    echo "   ✅ Removed aide's rules from ${destination/#$HOME/\~}; your own text is kept"
  else
    rm "$destination"
    echo "   ✅ Removed: ${destination/#$HOME/\~}"
  fi
}
