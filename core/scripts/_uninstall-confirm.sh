#!/usr/bin/env bash
# The question an uninstaller asks after listing what it removes.

# Asks "Are you sure", and exits 0 with "❌ Aborted" on anything but y/Y.
aide_confirm_or_abort() {
  local confirm
  echo ""
  read -r -p "Are you sure you want to continue? [y/N]: " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo ""
    echo "❌ Aborted"
    exit 0
  fi
  echo ""
}
