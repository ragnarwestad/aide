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
# Which options are valid, and whether each takes a value, is read from
# serve-args.json — the same list the serve code's argument parser reads.
# It is read with sed, so the file keeps one flag per line.
#
# Prints one line per option it removed; exits non-zero when the plist
# could not be read or written, or the definition names no flag.
#
# Usage: repair-serve-plist.sh <plist> <serve-args.json>

set -u

plist="${1:?usage: repair-serve-plist.sh <plist> <serve-args.json>}"
definition="${2:?usage: repair-serve-plist.sh <plist> <serve-args.json>}"
buddy=/usr/libexec/PlistBuddy

# "<flag> <true|false>" per defined flag. None read is a definition this
# script cannot understand, and dropping every option would stop the board.
defined=$(sed -n -E 's/^ *"(--[a-z][a-z-]*)": *\{ *"takesValue": *(true|false) *\}.*/\1 \2/p' "$definition")
[ -n "$defined" ] || exit 1

# Prints "true" or "false" for a defined flag, nothing for any other text.
takes_value() {
  local flag value
  while read -r flag value; do
    if [ "$flag" = "$1" ]; then
      echo "$value"
      return
    fi
  done <<< "$defined"
}

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
  next=$((i + 1))
  if [[ "$arg" == --[a-z]* ]]; then
    case "$(takes_value "$arg")" in
      true) i=$next ;;  # its value is kept, whatever it looks like
      false) ;;
      *)
        drop+=("$i")
        # The argument after a dropped option is its value, unless it is
        # an option this build accepts.
        if [ "$next" -lt "${#args[@]}" ] && [ -z "$(takes_value "${args[$next]}")" ]; then
          drop+=("$next")
          i=$next
        fi
        echo "removed $arg from $plist"
        ;;
    esac
  fi
  i=$((i + 1))
done

for ((k = ${#drop[@]} - 1; k >= 0; k--)); do
  "$buddy" -c "Delete :ProgramArguments:${drop[$k]}" "$plist" || exit 1
done
