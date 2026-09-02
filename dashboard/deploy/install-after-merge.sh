#!/bin/bash
# What a code merge in aide runs on the serving host (AIDE_INSTALL_CMD in
# .aide/config, spec 96): install the shared scripts and skills and
# refresh the dashboard's dependencies. It used to restart the dashboard
# server itself, last and detached; that restart moved into the server
# process (spec 287, dashboard/src/serve/land-branch/restart.ts) so it
# can wait for any OTHER landing still mid-`git push` — anywhere, not
# just this repo — before killing the process running it.
set -e
cd "$(dirname "$0")/../.."
# launchd's PATH has neither ~/.local/bin nor mise's shims. Without them
# the installer below reports mise, claude and codex as not installed —
# so the tools aide declares (spec 334) are skipped and the banner the
# dashboard reads from the log warns on every single merge.
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
# A tool the installer could not declare (spec 334) used to vanish into
# /dev/null on a headless merge nobody is watching. It now reaches a log
# file the dashboard's own shell.ts reads a warning banner from.
LOG="${AIDE_INSTALL_LOG:-$HOME/Library/Logs/aide-dashboard/install.log}"
mkdir -p "$(dirname "$LOG")"
{
  echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"
  ./implementations/claude-code/install.sh
  # Codex too, or its copy of the skills and AGENTS.md drifts silently:
  # both tools read the SAME shared sources, but each has its own
  # installer, and only Claude Code's ran here. Found 2026-08-19, when
  # Codex created a spec on the four-file layout that spec 82 replaced —
  # it had been reading its 16 August copy ever since. Copilot is parked
  # (no subscription), and `~/.agents/skills/` — the directory Copilot
  # reads too — is refreshed by this installer anyway.
  ./implementations/codex/install.sh
} >> "$LOG" 2>&1
BUN="${AIDE_DASH_BUN:-$HOME/.local/share/mise/shims/bun}"
if [ -x "$BUN" ]; then
  ( cd dashboard && "$BUN" install --silent )
  # The e2e suite's own browser (spec 348, REQ-6): a machine-level cache
  # under $HOME, not a `dashboard/node_modules` thing `bun install`
  # already covers — the first `make test` on a host that has never run
  # this before finds no Chromium executable otherwise.
  ( cd dashboard && "$(dirname "$BUN")/bunx" playwright install chromium )
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
