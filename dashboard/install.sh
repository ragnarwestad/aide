#!/usr/bin/env bash
# install.sh - Install the dashboard on this machine as a launchd job.
#
# Aide itself has to be installed first (./install-all.sh at the repo
# root): every step the dashboard runs goes through Aide's scripts. The
# install checks that, and the rest it needs, before it changes anything
# (deploy/check-prerequisites.sh).
#
# The same install on another machine, over ssh: MINI=<host> make install-serve
# On a machine with no launchd, such as Linux, dashboard/serve.sh runs it.
#
# Usage: dashboard/install.sh [VAR=value ...]   (make variables, e.g. PORT=8788)

set -e

if ! command -v launchctl >/dev/null 2>&1; then
  echo "this machine has no launchd, so the dashboard cannot be installed as a service here" >&2
  echo "run it in a terminal instead: dashboard/serve.sh" >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")"
exec make install-local "$@"
