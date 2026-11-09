#!/usr/bin/env bash
# run-spec/turn/test-start.sh — sourced by aide-run-spec before run-spec/turn/step-tests.sh.
#
# A red test run is not always a failing test: the suite can stop before
# any test ran, because the server it starts could not start, or a
# service it needs on this machine is not running. No session can fix a
# port another process holds or start Docker, so step-tests.sh asks these
# functions first and ends such a run `tests-not-started`, with the cause
# as fields the dashboard words, instead of handing it back for fix rounds.

# $1 = the test run's log. Prints the cause as one JSON object — kind
# `port-in-use` (with `port`), `server-timeout` (with `ms`),
# `server-exited`, `docker-down` or `connection-refused` (with `port`) —
# and `line`, the log line it was read from. Prints nothing when the log
# shows no start failure.
test_start_failure() {
  local log="$1" line url port ms
  [ -f "$log" ] || return 0
  # Tests that ran and failed say so; a port message beside them is a
  # line some test printed, not the reason the run stopped.
  grep -qE '^\(fail\)|^FAILED|^ERROR|[0-9]+ failed' "$log" && return 0
  # Playwright's webServer: "Error: http://localhost:8806/health/ready is
  # already used, make sure that nothing is running on the port/url ...".
  line="$(grep -m1 -E 'https?://[^ ]+ is already used, make sure that nothing is running on the port/url' "$log" | sed $'s/\033\\[[0-9;]*m//g')"
  if [ -n "$line" ]; then
    url="$(printf '%s' "$line" | grep -oE 'https?://[^ ]+' | head -1)"
    port="$(printf '%s' "$url" | sed -nE 's#^https?://[^/:]+:([0-9]+).*#\1#p')"
    if [ -z "$port" ]; then
      case "$url" in https://*) port=443 ;; *) port=80 ;; esac
    fi
    jq -cn --argjson port "$port" --arg url "$url" --arg line "$line" \
      '{kind:"port-in-use", port:$port, url:$url, line:$line}'
    return 0
  fi
  # Node: "Error: listen EADDRINUSE: address already in use :::8806", and
  # Go/Docker: "listen tcp 0.0.0.0:1025: bind: address already in use".
  # Only with a port: without one there is nothing to look up.
  line="$(grep -E 'EADDRINUSE|bind: address already in use' "$log" | sed $'s/\033\\[[0-9;]*m//g' | grep -m1 -E ':[0-9]+')"
  if [ -n "$line" ]; then
    port="$(printf '%s' "$line" | grep -oE ':[0-9]+' | tail -1 | tr -d ':')"
    jq -cn --argjson port "$port" --arg line "$line" '{kind:"port-in-use", port:$port, line:$line}'
    return 0
  fi
  # Playwright: "Error: Timed out waiting 60000ms from config.webServer."
  line="$(grep -m1 -E 'Timed out waiting [0-9]+ms from config\.webServer' "$log" | sed $'s/\033\\[[0-9;]*m//g')"
  if [ -n "$line" ]; then
    ms="$(printf '%s' "$line" | sed -nE 's/.*Timed out waiting ([0-9]+)ms.*/\1/p')"
    jq -cn --argjson ms "$ms" --arg line "$line" '{kind:"server-timeout", ms:$ms, line:$line}'
    return 0
  fi
  # Playwright: "Error: Process from config.webServer was not able to
  # start. Exit code: 1" or "... exited early."
  line="$(grep -m1 -E 'Process from config\.webServer (was not able to start|exited early)' "$log" | sed $'s/\033\\[[0-9;]*m//g')"
  if [ -n "$line" ]; then
    jq -cn --arg line "$line" '{kind:"server-exited", line:$line}'
    return 0
  fi
  # Docker's client when its daemon is not running: "Cannot connect to the
  # Docker daemon at unix:///…/docker.sock. Is the docker daemon running?"
  line="$(grep -m1 -E 'Cannot connect to the Docker daemon' "$log" | sed $'s/\033\\[[0-9;]*m//g')"
  if [ -n "$line" ]; then
    jq -cn --arg line "$line" '{kind:"docker-down", line:$line}'
    return 0
  fi
  # Node: "Error: connect ECONNREFUSED 127.0.0.1:5432" — a service the
  # tests need on this machine is not running. Another host's refusal is
  # not this machine's to start.
  line="$(grep -E 'ECONNREFUSED (127\.0\.0\.1|::1|localhost):[0-9]+' "$log" | sed $'s/\033\\[[0-9;]*m//g' | head -1)"
  if [ -n "$line" ]; then
    port="$(printf '%s' "$line" | sed -nE 's/.*ECONNREFUSED (127\.0\.0\.1|::1|localhost):([0-9]+).*/\2/p')"
    jq -cn --argjson port "$port" --arg line "$line" '{kind:"connection-refused", port:$port, line:$line}'
    return 0
  fi
  return 0
}

# $1 = a TCP port. Prints who listens on it as one JSON object — `pid`,
# `command`, `cwd`, and `project` and `spec` when the cwd lies in an
# Aide worktree (…/worktrees/<project>/<spec-folder>/…) — or nothing when
# no one does, or lsof is not there to ask.
port_holder() {
  local port="$1" pid info command cwd rest project spec
  command -v lsof >/dev/null 2>&1 || return 0
  pid="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)"
  [ -n "$pid" ] || return 0
  info="$(lsof -a -p "$pid" -d cwd -Fcn 2>/dev/null)"
  command="$(printf '%s\n' "$info" | sed -n 's/^c//p' | head -1)"
  cwd="$(printf '%s\n' "$info" | sed -n 's/^n//p' | head -1)"
  case "$cwd" in
    */worktrees/*/*)
      rest="${cwd##*/worktrees/}"
      project="${rest%%/*}"
      rest="${rest#*/}"
      spec="${rest%%/*}"
      ;;
  esac
  jq -cn --argjson pid "$pid" --arg command "$command" --arg cwd "$cwd" \
    --arg project "${project:-}" --arg spec "${spec:-}" \
    '{pid:$pid}
     + (if $command == "" then {} else {command:$command} end)
     + (if $cwd == "" then {} else {cwd:$cwd} end)
     + (if $project == "" or $spec == "" then {} else {project:$project, spec:$spec} end)'
}

# $1 = a file, $2 = bytes. The end of the file, at most that many bytes,
# starting at the beginning of a line: a cut through the middle of a word
# reads as a word that does not exist. A last line longer than the limit
# is cut all the same, since nothing at all says less.
log_tail() {
  local file="$1" bytes="$2" size out
  [ -f "$file" ] || return 0
  size="$(wc -c < "$file" | tr -d ' ')"
  if [ "$size" -le "$bytes" ]; then
    cat "$file"
    return 0
  fi
  out="$(tail -c "$((bytes + 1))" "$file" | sed 1d)"
  [ -n "$out" ] || out="$(tail -c "$bytes" "$file")"
  printf '%s' "$out"
}
