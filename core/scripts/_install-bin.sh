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

COMMON_BIN_SCRIPTS="aide-generate-pdf aide-generate-html aide-preflight validate-env upgrade-ai-tools _aide-spec-lib.sh"
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
