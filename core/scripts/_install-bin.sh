#!/usr/bin/env bash
# Felles installasjon/avinstallasjon av core/scripts i ~/.local/bin.
#
# Dette er den ENE kilden til lista over felles CLI-scripts. Hver
# implementations/<ai>/install.sh og uninstall.sh source-er denne fila og
# kaller install_common_bin / uninstall_common_bin — så lista finnes ett sted.
#
# AI-spesifikke scripts (f.eks. codex-aide-*) håndteres av den enkelte
# installeren, ikke her.

COMMON_BIN_SCRIPTS="aide-generate-pdf aide-generate-html mise-upgrade-ai-tools _aide-report-lib.sh"
_CORE_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_common_bin() {
  mkdir -p ~/.local/bin
  local s
  for s in $COMMON_BIN_SCRIPTS; do
    if [ -f "$_CORE_SCRIPTS_DIR/$s" ]; then
      cp "$_CORE_SCRIPTS_DIR/$s" ~/.local/bin/
      chmod +x ~/.local/bin/"$s"
      echo "   ✅ Installert: ~/.local/bin/$s"
    fi
  done
}

uninstall_common_bin() {
  local s
  for s in $COMMON_BIN_SCRIPTS; do
    if [ -f "$HOME/.local/bin/$s" ]; then
      rm "$HOME/.local/bin/$s"
      echo "   ✅ Fjernet: ~/.local/bin/$s"
    fi
  done
}
