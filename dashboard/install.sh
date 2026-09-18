#!/usr/bin/env bash
# install.sh - Install the dashboard on this machine as a launchd job.
#
# Aide itself has to be installed first (./install-all.sh at the repo
# root): every step the dashboard runs goes through Aide's scripts. The
# install checks that, and the rest it needs, before it changes anything
# (deploy/check-prerequisites.sh).
#
# The same install on another machine, over ssh: MINI=<host> make install-serve
#
# Usage: dashboard/install.sh [VAR=value ...]   (make variables, e.g. PORT=8788)

set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
exec make install-local "$@"
