#!/usr/bin/env bash
# Read one classification from the shared terminal-ending catalogue.

STEP_ENDINGS_FILE="$SCRIPT_DIR/lib/step-endings/catalog.json"

step_ending_has() { # $1 = reason, $2 = boolean field
  jq -e --arg reason "$1" --arg field "$2" \
    '.reasons[] | select(.name == $reason) | .[$field] == true' \
    "$STEP_ENDINGS_FILE" >/dev/null 2>&1
}
