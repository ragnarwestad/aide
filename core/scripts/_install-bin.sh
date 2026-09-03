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

COMMON_BIN_SCRIPTS="aide-generate-pdf aide-generate-html aide-preflight aide-emit-run aide-run-spec aide-archive-spec aide-create-spec aide-record-test-run aide-resolve-test-cmd aide-backfill-spec-state aide-write-spec aide-print-specs-guard aide-pull-specs aide-install-spec-hook validate-env upgrade-ai-tools _aide-spec-lib.sh"
# The hook body aide-install-spec-hook writes into a target repo (spec
# 219). Kept as its own file under core/scripts/hooks/, not embedded in
# the installer, so it can be tested standalone — which means it needs
# its own copy step, since the loop above only copies flat files.
COMMON_BIN_HOOK_SCRIPTS="commit-msg-spec-guard"
# status-progress.sh (spec 285): sourced by aide-run-spec and
# aide-archive-spec via "$SCRIPT_DIR/lib/status-progress.sh". Missing
# from COMMON_BIN_SCRIPTS (a flat-file copy into ~/.local/bin/ itself)
# and never given its own copy step here either, so no installed
# environment ever actually had it: `source ... && ...` silently no-ops
# when the file is absent, leaving status_progress_for undefined and
# every call to it a "command not found" that crashes aide-run-spec
# under set -u before it can write a result.
#
# workflow-steps.json (spec 349): the one file holding the workflow's
# step lists, read by aide-run-spec (jq) and imported by the dashboard.
# Unlike status-progress.sh above, a missing copy here is refused loudly
# by aide-run-spec rather than silently no-op'd.
COMMON_BIN_LIB_SCRIPTS="status-progress.sh workflow-steps.json spec-state.sh"
# Non-AI CLI tools aide's installer keeps present via mise, using the
# same npm:<pkg> declaration style as the AI CLIs in
# ~/.config/mise/config.toml (npm:playwright is the existing precedent).
# upgrade-ai-tools must upgrade every name listed here — a test in
# tests/specs/unit/core/validation/test_core_scripts.py enforces it.
#
# Every external CLI aide's own scripts shell out to, declared once so
# every machine that runs aide's installer has it (spec 334). A tool
# with no mise-manageable backend (mise itself: it cannot declare
# itself) is checked instead of declared — its absence still reaches
# the installed-files warning banner via install_mise_declared_tools's
# own "no mise" warning. TestRequiredToolsAreDeclared fails when a
# script or installer checks for a tool that is not in this list.
MISE_DECLARED_TOOLS="npm:markdownlint-cli2 jq gh bun pandoc npm:md-to-pdf"
_CORE_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Replace an installed script by RENAME, never by writing into it: bash
# reads a running script incrementally by byte offset, so `cp` over one
# that a gate or a step is executing right now corrupts that run at its
# next line. A new file moved into place keeps the old inode alive for
# whoever still has it open.
_install_file() {   # $1 = source, $2 = destination path
  cp "$1" "$2.aide-tmp" && chmod +x "$2.aide-tmp" && mv -f "$2.aide-tmp" "$2"
}

install_common_bin() {
  mkdir -p ~/.local/bin
  local s
  for s in $COMMON_BIN_SCRIPTS; do
    if [ -f "$_CORE_SCRIPTS_DIR/$s" ]; then
      _install_file "$_CORE_SCRIPTS_DIR/$s" ~/.local/bin/"$s"
      echo "   ✅ Installed: ~/.local/bin/$s"
    fi
  done
  mkdir -p ~/.local/bin/hooks
  for s in $COMMON_BIN_HOOK_SCRIPTS; do
    if [ -f "$_CORE_SCRIPTS_DIR/hooks/$s" ]; then
      _install_file "$_CORE_SCRIPTS_DIR/hooks/$s" ~/.local/bin/hooks/"$s"
      echo "   ✅ Installed: ~/.local/bin/hooks/$s"
    fi
  done
  mkdir -p ~/.local/bin/lib
  for s in $COMMON_BIN_LIB_SCRIPTS; do
    if [ -f "$_CORE_SCRIPTS_DIR/lib/$s" ]; then
      _install_file "$_CORE_SCRIPTS_DIR/lib/$s" ~/.local/bin/lib/"$s"
      echo "   ✅ Installed: ~/.local/bin/lib/$s"
    fi
  done
  # Records which repo checkout and commit this ~/.local/bin copy came
  # from, so a later aide-preflight run can tell it apart from the
  # repo's current HEAD (REQ-7).
  local repo_root sha
  repo_root="$(cd "$_CORE_SCRIPTS_DIR/../.." && pwd)"
  sha="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo unknown)"
  printf '%s\n%s\n%s\n' "$repo_root" "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > ~/.local/bin/.aide-installed-version
}

install_mise_declared_tools() {
  if ! command -v mise &> /dev/null; then
    echo "   ⚠️  [aide tools] mise is not installed — skipping $MISE_DECLARED_TOOLS (install mise: https://mise.jdx.dev)"
    return 0
  fi
  if ! mise which node &> /dev/null; then
    echo "   ⚠️  [aide tools] mise has no node installed — skipping $MISE_DECLARED_TOOLS (mise use -g node, then re-run this installer)"
    return 0
  fi
  local tool
  for tool in $MISE_DECLARED_TOOLS; do
    if mise use -g "$tool@latest" &> /dev/null; then
      echo "   ✅ Declared via mise: $tool"
    else
      echo "   ⚠️  [aide tools] mise use -g $tool@latest failed — markdown linting will be skipped until it is installed"
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
  for s in $COMMON_BIN_HOOK_SCRIPTS; do
    if [ -f "$HOME/.local/bin/hooks/$s" ]; then
      rm "$HOME/.local/bin/hooks/$s"
      echo "   ✅ Removed: ~/.local/bin/hooks/$s"
    fi
  done
  for s in $COMMON_BIN_LIB_SCRIPTS; do
    if [ -f "$HOME/.local/bin/lib/$s" ]; then
      rm "$HOME/.local/bin/lib/$s"
      echo "   ✅ Removed: ~/.local/bin/lib/$s"
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
