#!/usr/bin/env bash
# check-prerequisites.sh - What the dashboard needs on the host that serves
# it, checked on that host before anything is installed there.
#
# Runs in the host's $HOME: over ssh for `make install-serve`, locally for
# `make install-local`. Missing a required tool stops the install with the
# command that fixes it; missing an optional one only says what will not
# work without it.
#
# Usage: check-prerequisites.sh <bun path, relative to $HOME>

set -u

bun_path="${1:?usage: check-prerequisites.sh <bun path, relative to \$HOME>}"
missing=0
# Aide's installer puts its tools behind mise's shims, which an ssh
# command's shell does not have on PATH.
PATH="$PATH:$HOME/.local/share/mise/shims"

need() { # need <what> <how to get it>
  echo "missing: $1 — $2" >&2
  missing=1
}

warn() { # warn <what> <what does not work without it>
  echo "warning: $1 is not installed — $2" >&2
}

command -v launchctl >/dev/null 2>&1 ||
  need "launchctl" "the dashboard runs as a launchd job, so it needs macOS"
command -v git >/dev/null 2>&1 ||
  need "git" "xcode-select --install"
# The plist names these by absolute path, because launchd's PATH has
# neither ~/.local/bin nor mise's shims on it.
[ -x "$HOME/.local/bin/aide-run-spec" ] ||
  need "Aide (~/.local/bin/aide-run-spec)" "clone aide and run ./install-all.sh there first; every step runs through it"
command -v jq >/dev/null 2>&1 ||
  need "jq" "installed by Aide's installer through mise; every step refuses without it"
[ -x "$HOME/$bun_path" ] ||
  need "bun (~/$bun_path)" "installed by Aide's installer through mise; set REMOTE_BUN if yours lives elsewhere"

ai_found=""
for ai in claude codex opencode copilot; do
  command -v "$ai" >/dev/null 2>&1 && ai_found="$ai_found $ai"
done
[ -n "$ai_found" ] ||
  warn "an AI CLI (claude, codex, opencode or copilot)" "no step can run until one is installed and signed in"
[ -x "$HOME/.local/bin/aide-generate-pdf" ] && command -v md-to-pdf >/dev/null 2>&1 ||
  warn "md-to-pdf" "the PDF button on a spec's page fails"
command -v gh >/dev/null 2>&1 ||
  warn "gh" "a project with codeLanding: pr cannot open its pull request"

if [ "$missing" -ne 0 ]; then
  echo "Install what is missing above, then run the install again." >&2
  exit 1
fi
echo "prerequisites ok (AI CLI:${ai_found:- none})"
