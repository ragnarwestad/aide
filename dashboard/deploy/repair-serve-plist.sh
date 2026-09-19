#!/bin/bash
# repair-serve-plist.sh - Drop from the dashboard's launchd job every option
# the serve code no longer accepts, with the value that follows it.
#
# The job's arguments are written once, when the service is installed, and
# a merge installs code without touching them: code that drops an option
# leaves the job passing one the new build refuses, and the board dies at
# its next restart. install-after-merge.sh runs this where both halves are
# on disk; the restart that follows reloads the job from the file.
#
# Prints one line per option it removed; exits non-zero only when the plist
# could not be read or written.
#
# Usage: repair-serve-plist.sh <plist> <parse-args.ts>

set -u

plist="${1:?usage: repair-serve-plist.sh <plist> <parse-args.ts>}"
accepted="${2:?usage: repair-serve-plist.sh <plist> <parse-args.ts>}"
buddy=/usr/libexec/PlistBuddy

args=()
while IFS= read -r line; do
  args+=("$line")
done < <("$buddy" -c "Print :ProgramArguments" "$plist" | sed -e '1d' -e '$d' -e 's/^ *//')
[ "${#args[@]}" -gt 0 ] || exit 1

# Indexes to delete, collected first and deleted from the end, so an
# earlier delete never shifts a later one.
drop=()
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  arg="${args[$i]}"
  if [[ "$arg" == --[a-z]* ]] && ! grep -q -- "\"$arg\"" "$accepted"; then
    drop+=("$i")
    next=$((i + 1))
    if [ "$next" -lt "${#args[@]}" ] && [[ "${args[$next]}" != --* ]]; then
      drop+=("$next")
      i=$next
    fi
    echo "removed $arg from $plist"
  fi
  i=$((i + 1))
done

for ((k = ${#drop[@]} - 1; k >= 0; k--)); do
  "$buddy" -c "Delete :ProgramArguments:${drop[$k]}" "$plist" || exit 1
done
