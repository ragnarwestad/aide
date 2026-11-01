#!/usr/bin/env bash
# _login-check.sh - Sourced by install.sh: reports whether OpenCode has a
# provider logged in.
#
# OpenCode reaches every model through a provider, and has none configured
# until one is. A run with no credentials fails at the model, not at the
# setup, so it is worth saying here. `opencode auth list` says "0 credentials"
# before version 2 and "No authenticated integrations" from it.

report_opencode_login() {
  if ! command -v opencode &> /dev/null; then
    echo "   ⏭️  OpenCode is not installed, so no provider was checked"
    return 0
  fi
  if opencode auth list 2>/dev/null | grep -qE '\b0 credentials\b|No authenticated integrations'; then
    echo "   ⚠️  No provider is logged in — run: opencode auth login"
    echo "      Claude Agent, picked there or in /connect, uses this machine's Claude Code login"
  else
    echo "   ✅ At least one provider is configured"
  fi
}
