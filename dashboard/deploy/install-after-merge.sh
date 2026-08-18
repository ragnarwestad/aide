#!/bin/bash
# What a code merge in aide runs on the serving host (AIDE_INSTALL_CMD in
# .aide/config, spec 96): install the shared scripts and skills, refresh
# the dashboard's dependencies, then restart the dashboard server so the
# merged code is what serves. The restart comes last and detached — it
# kills the very process running this script — and its failure is not
# an error: on a machine without the launchd job (a laptop) there is
# nothing to restart.
set -e
cd "$(dirname "$0")/../.."
./implementations/claude-code/install.sh >/dev/null 2>&1
BUN="${AIDE_DASH_BUN:-$HOME/.local/share/mise/shims/bun}"
if [ -x "$BUN" ]; then ( cd dashboard && "$BUN" install --silent ); fi
LABEL="${AIDE_DASH_LABEL:-com.aide-dashboard.serve}"
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  nohup sh -c "sleep 1; launchctl kickstart -k gui/$(id -u)/$LABEL" >/dev/null 2>&1 &
fi
