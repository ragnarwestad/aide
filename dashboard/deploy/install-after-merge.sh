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
if [ -x "$BUN" ]; then
  ( cd dashboard && "$BUN" install --silent )
  # The static pages (overview, about, one per project) share the nav
  # with the served ones and are files on disk: a merge that changes the
  # shell leaves them stale until regenerated. Same root and site dir
  # the served instance uses.
  SITE="${AIDE_DASH_SITE:-$HOME/aide-dashboard/site}"
  ROOT="${AIDE_DASH_ROOT:-$HOME/develop}"
  if [ -d "$SITE" ] && [ -d "$ROOT" ]; then
    ( cd dashboard && "$BUN" run src/main.ts generate --root "$ROOT" --out "$SITE" >/dev/null 2>&1 ) || true
  fi
fi
LABEL="${AIDE_DASH_LABEL:-com.aide-dashboard.serve}"
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  nohup sh -c "sleep 1; launchctl kickstart -k gui/$(id -u)/$LABEL" >/dev/null 2>&1 &
fi
