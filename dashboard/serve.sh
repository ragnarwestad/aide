#!/usr/bin/env bash
# serve.sh - Run the dashboard in this terminal, queue included, on a
# machine with no launchd, such as Linux.
#
# The same arguments `install.sh` gives the launchd service on macOS, and
# the same state under ~/.aide/dashboard; it runs until it is stopped
# (Ctrl-C) and does not start again by itself after a reboot. Aide itself
# has to be installed first (./install-all.sh at the repo root).
#
# Usage: dashboard/serve.sh [NAME=value ...]
#   PORT            the port (8788)
#   BIND            the address it answers on (127.0.0.1, this machine only)
#   ROOT            the directory of projects (~/.aide/dashboard/projects)
#   QUEUE_PROJECTS  the projects the queue may run, comma-separated, until
#                   the Projects panel has saved its own list

set -euo pipefail

for arg in "$@"; do
  case "$arg" in
    PORT=*|BIND=*|ROOT=*|QUEUE_PROJECTS=*) export "${arg?}" ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

state="$HOME/.aide/dashboard"
port="${PORT:-8788}"
bind="${BIND:-127.0.0.1}"
root="${ROOT:-$state/projects}"
label="com.aide-dashboard.serve"

# Two servers on one state would run the same queue twice.
if command -v launchctl >/dev/null 2>&1 && launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  echo "the dashboard already runs as the launchd service $label on this machine" >&2
  exit 1
fi

missing=()
for tool in bun git jq; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
[ -x "$HOME/.local/bin/aide-run-spec" ] || missing+=("aide-run-spec (run ./install-all.sh at the repo root)")
if [ "${#missing[@]}" -gt 0 ]; then
  printf 'missing: %s\n' "${missing[@]}" >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p "$state/site" "$root"
bun install --silent
bun run src/main.ts generate --root "$root" --out "$state/site" >/dev/null

echo "the dashboard: http://$bind:$port/"
exec bun run src/serve/serve.ts serve \
  --site "$state/site" \
  --port "$port" \
  --mirror "$state/aide-runs.json" \
  --queue-mirror "$state/aide-queue.json" \
  --result-dir "$state/jobs" \
  --queue-config "$state/queue-config.json" \
  --runner-bin "$HOME/.local/bin/aide-run-spec" \
  --pdf-bin "$HOME/.local/bin/aide-generate-pdf" \
  ${QUEUE_PROJECTS:+--queue-projects "$QUEUE_PROJECTS"} \
  --root "$root" \
  --bind "$bind"
