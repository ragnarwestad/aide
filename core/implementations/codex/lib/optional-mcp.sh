#!/usr/bin/env bash
# optional-mcp.sh - Offer one optional set of MCP servers for ~/.codex/config.toml.
# Sourced by core/implementations/codex/install.sh.

# Whether someone is at the keyboard to answer.
optional_mcp_can_ask() {
  [ -t 0 ]
}

# offer_optional_mcp <config> <name> <label> <servers> <fragment> <docs> <intro line>...
#
#   config      the Codex config file to look in, and to append to
#   name        what is offered, e.g. "Context7 MCP"
#   label       the servers as the result lines name them, e.g. "Context7"
#   servers     the [mcp_servers.<server>] tables that must ALL be present,
#               space-separated, before the addition counts as configured
#   fragment    the TOML file appended, unchanged, when the user says yes
#   docs        the setup page named with the result
#   intro line  what the addition gives, one argument per printed line
#
# Asks only when standard input is a terminal; otherwise (install-all, CI) it
# skips, as the default answer No does. Sets MCP_CONFIGURED to true when every
# server is there afterwards, false when not.
offer_optional_mcp() {
  local config="$1" name="$2" label="$3" servers="$4" fragment="$5" docs="$6"
  shift 6
  local server server_list missing=false verb=is answer=N line
  read -ra server_list <<< "$servers"
  [ "${#server_list[@]}" -gt 1 ] && verb=are

  for server in "${server_list[@]}"; do
    if [ ! -f "$config" ] || ! grep -qF "[mcp_servers.$server]" "$config"; then
      missing=true
    fi
  done

  if [ "$missing" = false ]; then
    echo "   ✅ $label MCP $verb already configured"
    MCP_CONFIGURED=true
    return 0
  fi

  MCP_CONFIGURED=false
  echo "   ⚠️  $name is NOT configured"
  echo ""
  for line in "$@"; do
    echo "   $line"
  done
  echo ""
  echo "   Do you want to add $name now? [y/N]"
  if optional_mcp_can_ask; then
    read -r answer || answer=N
  fi

  if [[ "$answer" =~ ^[Yy]$ ]]; then
    echo ""
    echo "   🔧 Adding $name..."
    mkdir -p "$(dirname "$config")"
    cat "$fragment" >> "$config"
    echo "   ✅ Added $label to $config"
    MCP_CONFIGURED=true
    echo ""
    echo "   📚 More info: $docs"
  else
    echo "   ⏭️  Skipped $name configuration"
    echo "   💡 You can add it later in $config"
    echo ""
    echo "   📚 See: $docs"
  fi
}
