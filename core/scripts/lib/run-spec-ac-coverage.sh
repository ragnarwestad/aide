#!/usr/bin/env bash
# Which test covers which requirement, read off the tests' own names.
#
# A completed `implement` writes `ac-coverage.json` into the spec's
# folder: for every AC-n id in `1-description.md`, the tests whose names
# carry it. Only the lines the branch ADDED to test files count — `AC-1`
# is in the tests of many specs, and a file this step only touched still
# holds theirs. The dashboard shows the names on the row the user ticks,
# and an id with none as a requirement no test names.
#
# Sourced by aide-run-spec before PASS 1, so the file is committed and
# pushed with the rest of the step's work. Never fails the step: a
# record that cannot be written leaves the row without its tests.

# A path that holds tests, by the conventions the projects use.
ac_coverage_is_test_file() {   # $1: repo-relative path
  printf '%s\n' "$1" | grep -qE '(^|/)(test|tests|__tests__|spec|e2e)/|\.(test|spec)\.[A-Za-z]+$|(^|/)test_[^/]*\.py$|_test\.(py|go)$'
}

# Every line the branch added, as "<file><TAB><line>": the tracked
# change against where the branch left the default branch (the working
# tree included, so work not committed yet counts), and every line of a
# file not tracked yet.
ac_coverage_added_lines() {   # $1: worktree  $2: base ref
  local wt="$1" base="$2" fork
  fork="$(git -C "$wt" merge-base "$base" HEAD 2>/dev/null)" || return 0
  git -C "$wt" diff --no-color --no-ext-diff -U0 "$fork" -- . 2>/dev/null \
    | awk '/^\+\+\+ /{ f = ($2 == "/dev/null") ? "" : substr($2, 3); next }
           /^\+/ && f != "" { print f "\t" substr($0, 2) }'
  # A worktree's links (`node_modules`, `.venv`) are untracked links to
  # directories, not files: skipped, and never the loop's last word —
  # under the runner's pipefail a failing test here threw the whole
  # record away (498, 2026-09-19).
  git -C "$wt" ls-files --others --exclude-standard 2>/dev/null \
    | while IFS= read -r f; do
        if [ -f "$wt/$f" ] && [ ! -L "$wt/$f" ]; then
          awk -v f="$f" '{ print f "\t" $0 }' "$wt/$f"
        fi
      done
  return 0
}

# A line that starts a test: `test(`, `it(`, `describe(` and their
# `.each`/`.skip` forms, a Python `def test_…`, a Go `func Test…`. A
# comment or any other line naming an AC is not a test, even in a test
# file — 501's row read "Tests: // The control on the Notifications tab".
ac_coverage_is_test_line() {   # $1: the line
  printf '%s\n' "$1" | grep -qE '^[[:space:]]*((test|it|describe)(\.[A-Za-z]+)*[[:space:]]*\(|(async[[:space:]]+)?def[[:space:]]+test|func[[:space:]]+Test)'
}

# "<id><TAB><file><TAB><name>" for every AC reference in an added line
# that starts a test. The name is the line's first quoted string — a
# test's own title — or the line itself where it has none (a Python
# `def test_..._ac_3`).
ac_coverage_refs() {   # stdin: ac_coverage_added_lines
  local file line name ids id
  while IFS="$(printf '\t')" read -r file line; do
    ac_coverage_is_test_file "$file" || continue
    ac_coverage_is_test_line "$line" || continue
    ids="$(printf '%s\n' "$line" | grep -oiE '(^|[^a-z0-9])ac[-_]?[0-9]+' | grep -oE '[0-9]+$')" || continue
    [ -n "$ids" ] || continue
    # Up to the SAME quote that opened it: a title in double quotes may
    # hold an apostrophe ("a row's total").
    name="$(printf '%s\n' "$line" | perl -ne 'print $2 if /(["\x27`])((?:(?!\1).)+)\1/')"
    [ -n "$name" ] || name="$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]+//' | cut -c1-160)"
    for id in $ids; do printf 'AC-%s\t%s\t%s\n' "$((10#$id))" "$file" "$name"; done
  done
}

# The record itself, for a completed implement only.
write_ac_coverage() {
  [ "${command_name:-}" = "implement" ] && [ "${terminal_reason:-}" = "completed" ] || return 0
  local folder="$specs_root_wt/$spec_label" ids base base_ref
  [ -f "$folder/1-description.md" ] || return 0
  ids="$(grep -oE '^- \*\*AC-[0-9]+' "$folder/1-description.md" | grep -oE 'AC-[0-9]+' | sort -t- -k2 -n -u)"
  [ -n "$ids" ] || return 0
  base="$(default_branch "$project_root")"
  base_ref="$base"
  git -C "$project_wt" show-ref --verify --quiet "refs/remotes/origin/$base" && base_ref="origin/$base"
  if ac_coverage_added_lines "$project_wt" "$base_ref" | ac_coverage_refs \
    | jq -R -s --arg ids "$ids" '
        [split("\n")[] | select(length > 0) | split("\t") | {id: .[0], file: .[1], name: .[2]}] as $refs
        | {acs: ([$ids | split("\n")[] | select(length > 0)]
                 | map(. as $id | {key: $id,
                                   value: ([$refs[] | select(.id == $id) | {file, name}] | unique)})
                 | from_entries)}' \
      > "$folder/ac-coverage.json.tmp" 2>/dev/null; then
    mv "$folder/ac-coverage.json.tmp" "$folder/ac-coverage.json" \
      || rm -f "$folder/ac-coverage.json.tmp"
  else
    rm -f "$folder/ac-coverage.json.tmp"
  fi
}
