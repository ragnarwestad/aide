#!/usr/bin/env bash
# Shared installation/uninstallation of core/scripts into ~/.local/bin.
#
# This is the ONE source for the list of shared CLI scripts. Every
# implementations/<ai>/install.sh and uninstall.sh sources this file and
# calls install_common_bin / uninstall_common_bin — so the list lives in one place.
#
# AI-specific scripts (e.g. codex-aide-*) are handled by the individual
# installer, not here.

COMMON_BIN_SCRIPTS="aide-generate-pdf aide-generate-html mise-upgrade-ai-tools _aide-report-lib.sh"
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
