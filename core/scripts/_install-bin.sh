#!/usr/bin/env bash
# Shared installation/uninstallation of core/scripts into ~/.local/bin.
#
# This is the ONE source for the list of shared CLI scripts. Every
# implementations/<ai>/install.sh sources this file and calls
# install_common_bin — so the list lives in one place. uninstall_common_bin
# is called ONLY by uninstall-all.sh: individual uninstallers must leave the
# shared scripts alone, since the other AI tools (and the cron job) use them.
#
# AI-specific scripts are handled by the individual
# installer, not here.

COMMON_BIN_SCRIPTS="aide-generate-pdf aide-generate-html aide-preflight aide-emit-run aide-run-spec aide-pull-specs validate-env upgrade-ai-tools _aide-spec-lib.sh"
_CORE_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_common_bin() {
  mkdir -p ~/.local/bin
  local s
  for s in $COMMON_BIN_SCRIPTS; do
    if [ -f "$_CORE_SCRIPTS_DIR/$s" ]; then
      cp "$_CORE_SCRIPTS_DIR/$s" ~/.local/bin/
      chmod +x ~/.local/bin/"$s"
      echo "   ✅ Installed: ~/.local/bin/$s"
    fi
  done
}

uninstall_common_bin() {
  local s
  for s in $COMMON_BIN_SCRIPTS; do
    if [ -f "$HOME/.local/bin/$s" ]; then
      rm "$HOME/.local/bin/$s"
      echo "   ✅ Removed: ~/.local/bin/$s"
    fi
  done
}

# --- PATH for non-interactive shells (spec 175) ------------------------------
#
# `ssh host 'command'` starts a NON-INTERACTIVE shell, which reads neither
# .zprofile, .zshrc nor .bash_profile — so tools in these directories are
# "command not found" over ssh while a person at the machine finds them.
# zsh always reads ~/.zshenv; bash reads ~/.bashrc for exactly this case.
# Written by every installer, removed only by uninstall-all.sh — the same
# contract as the shared scripts above.
#
# STABLE directories only. A versioned path (mise's bun install dir, say)
# rots at the next upgrade, which is why the deploy scripts name such tools
# by full path instead.
AIDE_PATH_DIRS='/opt/homebrew/bin /usr/local/bin $HOME/.local/bin'

_AIDE_PATH_BLOCK_START="# >>> aide PATH (managed by aide, do not edit by hand) >>>"
_AIDE_PATH_BLOCK_END="# <<< aide PATH <<<"

_aide_path_block() {
  echo "$_AIDE_PATH_BLOCK_START"
  local dir
  for dir in $AIDE_PATH_DIRS; do
    # Guarded per directory so a nested shell never grows PATH.
    echo "case \":\$PATH:\" in *\":$dir:\"*) ;; *) export PATH=\"$dir:\$PATH\" ;; esac"
  done
  echo "$_AIDE_PATH_BLOCK_END"
}

# Removes the block, markers included, and nothing else. Lines outside the
# two markers are copied through untouched.
_aide_remove_path_block() {
  local file="$1"
  [ -f "$file" ] || return 0
  grep -qF "$_AIDE_PATH_BLOCK_START" "$file" 2>/dev/null || return 0
  awk -v start="$_AIDE_PATH_BLOCK_START" -v end="$_AIDE_PATH_BLOCK_END" '
    $0 == start { skip = 1 }
    skip == 0 { print }
    $0 == end { skip = 0 }
  ' "$file" > "$file.aide-tmp" && mv "$file.aide-tmp" "$file"
}

# Strips any block from an earlier install, then writes the current one.
#
# position=append for ~/.zshenv: zsh reads the whole file, so where the
# block sits does not matter.
# position=prepend for ~/.bashrc: most .bashrc templates (Debian/Ubuntu's
# /etc/skel/.bashrc among them) open with a non-interactive early return,
# and a block after that guard would never run for the ssh case this
# exists to fix.
_aide_write_path_file() {
  local file="$1"
  local position="${2:-append}"
  touch "$file"
  _aide_remove_path_block "$file"
  if [ "$position" = "prepend" ]; then
    { _aide_path_block; cat "$file"; } > "$file.aide-tmp" && mv "$file.aide-tmp" "$file"
  else
    # Without a trailing newline the block's first line would be glued onto
    # the file's last one — corrupting it, and breaking the marker match on
    # the next install.
    if [ -n "$(tail -c1 "$file")" ]; then
      echo >> "$file"
    fi
    _aide_path_block >> "$file"
  fi
}

install_shell_path() {
  _aide_write_path_file "$HOME/.zshenv" append
  _aide_write_path_file "$HOME/.bashrc" prepend
  echo "   ✅ PATH for non-interactive shells (ssh): ~/.zshenv, ~/.bashrc"
}

uninstall_shell_path() {
  _aide_remove_path_block "$HOME/.zshenv"
  _aide_remove_path_block "$HOME/.bashrc"
  echo "   ✅ Removed aide's PATH block from ~/.zshenv and ~/.bashrc"
}
