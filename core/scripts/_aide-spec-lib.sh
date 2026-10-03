#!/usr/bin/env bash
# Shared helper functions for aide-generate-pdf and aide-generate-html.
# Sourced by both from the same directory:
#   SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
#   source "$SCRIPT_DIR/_aide-spec-lib.sh"
#
# Flat structure: all issues live as <NN>-slug/ directly under the specs root
# (an issue key in the title stays part of the slug).

# Find the specs root for a project (spec 73: per-project config, no
# global state).
#   aide_specs_root [project-root]
# The root defaults to the git toplevel, falling back to the current
# directory. AIDE_SPECS_PATH read from <root>/.aide/config wins;
# otherwise <root>/specs. The environment variable of the same name is
# retired and deliberately ignored.
aide_specs_root() {
  local root="$1" configured
  if [ -z "$root" ]; then
    root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  fi
  configured="$(aide_config_get AIDE_SPECS_PATH "$root")"
  if [ -n "$configured" ]; then
    echo "$configured"
  else
    echo "$root/specs"
  fi
}

# Search one directory for a folder matching a find pattern; echoes the basename.
_aide_find_spec() {
  local dir="$1" flag="$2" pattern="$3"
  find "$dir" -maxdepth 1 -type d "$flag" "$pattern" 2>/dev/null | head -1 | xargs basename 2>/dev/null
}

# Resolve input to a folder name under the specs root. Echoes the folder
# name (possibly prefixed "archive/"), or nothing. Active specs win over
# archived ones with the same number.
# Input: NN | todo-NN | <ISSUE-KEY> (e.g. PROJ-7637, MEL-123) | full <NN>-slug
aide_resolve_spec() {
  local input="$1" root="$2" dir="" flag="" pattern="" num
  if [ -d "$root/$input" ]; then
    echo "$input"                                         # direct full-ID match
    return
  elif echo "$input" | grep -qiE '^(todo-)?[0-9]+$'; then
    # Number shorthand ("27", "05" or "todo-27"); base 10 avoids octal errors
    num="${input#[Tt][Oo][Dd][Oo]-}"
    flag="-name"; pattern="$(printf '%02d' "$((10#$num))")-*"
  elif echo "$input" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$'; then
    # Issue key (any project prefix): the key is part of the slug
    flag="-iname"; pattern="*${input}*"
  else
    echo "$input"                                         # assume full folder ID
    return
  fi
  dir=$(_aide_find_spec "$root" "$flag" "$pattern")
  if [ -z "$dir" ] && [ -d "$root/archive" ]; then
    dir=$(_aide_find_spec "$root/archive" "$flag" "$pattern")
    [ -n "$dir" ] && dir="archive/$dir"
  fi
  echo "$dir"
}

# Next free spec number across the root AND archive/, zero-padded.
# Archived specs keep their number — scanning both means a number is
# never reused after its spec is archived.
aide_next_spec_number() {
  local root="$1" max
  max=$( { ls -1 "$root" 2>/dev/null; ls -1 "$root/archive" 2>/dev/null; } \
    | sed -n 's/^\([0-9][0-9]*\)-.*/\1/p' | sort -n | tail -1)
  printf '%02d\n' "$(( 10#${max:-0} + 1 ))"
}

# The slug side of Step 3 in core/skills/aide-create/SKILL.md, made
# deterministic (spec 433): lowercase, transliterate the diacritics this
# project's own titles actually use, drop anything else non-ASCII, spaces
# and runs of special characters collapse to one hyphen, no leading or
# trailing hyphen. SKILL.md's Step 3 names this exact algorithm so a
# human reading the skill and this function never drift apart.
#
# Not the same one-liner run-spec/setup/invocation.sh:122-124 builds for the
# AI prompt's own throwaway TODO-<slug> token — that one is explicitly
# commented as NOT the spec's folder slug and has no diacritic handling.
# This is the first version meant to BE the real folder slug.
#
# The diacritic sed runs under LC_ALL=C.UTF-8, scoped to that one command:
# in the "C" locale a bracket expression matches BYTES, not characters, and
# every one of these diacritics is multi-byte UTF-8 — under "C" the class
# matches half a character and corrupts the string (verified: "på" came
# out "paea"). C.UTF-8 is the portable minimal UTF-8 locale, expected to
# exist wherever this runs; the override is per-command so it never
# changes how the REST of this script sorts or matches.
aide_slug_from_title() {
  local title="$1" slug
  slug="$(printf '%s' "$title" \
    | LC_ALL=C.UTF-8 sed -e 's/[ÆæÄä]/ae/g' -e 's/[ØøÖö]/o/g' -e 's/[ÅåÁáÀàÂâ]/a/g' \
          -e 's/[ÉéÈèÊê]/e/g' -e 's/[ÜüÚúÛû]/u/g' -e 's/[ÍíÌìÎî]/i/g' \
          -e 's/[ÓóÒòÔô]/o/g' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//')"
  [ -n "$slug" ] || slug="new-spec"
  printf '%s\n' "$slug"
}

# Read a key from the per-project config file <project-root>/.aide/config
# (KEY=value lines, # comments). Echoes the value, or nothing if the file
# or key is missing. Usage: aide_config_get KEY [project-root]
aide_config_get() {
  local key="$1" root="${2:-.}" file
  file="$root/.aide/config"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | head -1
}

# Read a TOP-LEVEL scalar key from the project's manifest
# <project-root>/.aide/project.yaml. Echoes the value, or nothing if the
# file or the key is missing. Usage: aide_manifest_get KEY [project-root]
#
# The manifest is where a setting that travels with the REPO belongs
# (spec 184): .aide/config is dropped by a global ignore rule, so
# anything written there is lost the moment the project meets a new
# machine, while .aide/project.yaml is committed.
#
# Deliberately a sibling of aide_config_get rather than a YAML parser.
# A top-level scalar is one anchored sed away, and that is the whole
# shape this reads: `^key: value`. An indented key belongs to whatever
# block it sits under and is not this one, so the anchor is load-bearing
# rather than incidental. Nesting would need a hand-written collector —
# /bin/bash here is 3.2, with no mapfile — and a silent misparse of a
# gitignored-path list is a worktree that comes up missing what the
# project's own commands need, with nothing said about it.
aide_manifest_get() {
  local key="$1" root="${2:-.}" file value q
  file="$root/.aide/project.yaml"
  [ -f "$file" ] || return 0
  value="$(sed -n "s/^${key}:[[:space:]]*//p" "$file" | head -1 | sed 's/[[:space:]]*$//')"
  # A value quoted as a whole is a YAML string, and is read the way the
  # dashboard's YAML parser reads it: without the quotes.
  # shellcheck disable=SC1003 # a literal backslash, not an escaped quote
  case "$value" in
    '"'*'"') value="${value:1:${#value}-2}"; value="${value//\\\"/\"}"; value="${value//\\\\/\\}" ;;
    "'"*"'") value="${value:1:${#value}-2}"; q="'"; value="${value//$q$q/$q}" ;;
  esac
  printf '%s\n' "$value"
}

# Readable name from folder ID (NN-slug → Title Case)
get_display_name() {
  local id="$1" slug
  if [[ "$id" =~ ^[0-9]+-(.+)$ ]]; then
    slug="${BASH_REMATCH[1]}"
    echo "$slug" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2));}1'
  else
    echo "$id"
  fi
}

# The specs a spec builds on: the optional "Depends on:" line in its OWN
# 1-description.md (spec 92), echoed one identifier per line. Comma
# separated, backticks and surrounding whitespace stripped.
#   aide_spec_dependencies <specs-root> <spec-folder>
# An absent field, an empty one, or a missing file is the normal case and
# says nothing at all — same shape as aide_config_get.
aide_spec_dependencies() {
  local root="$1" folder="$2" file value
  file="$root/$folder/1-description.md"
  [ -f "$file" ] || return 0
  value="$(sed -n 's/^[[:space:]]*-[[:space:]]*\*\*Depends on:\*\*[[:space:]]*//p' "$file" | head -1)"
  [ -n "$value" ] || return 0
  echo "$value" | tr ',' '\n' | tr -d '`' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true
}

# How strictly analyze checks the spec's acceptance criteria: the value of
# the optional "Acceptance criteria checks:" line in its OWN
# 1-description.md, as written. Nothing for a missing file or line, which
# the caller reads as off — same shape as aide_spec_dependencies.
#   aide_spec_criteria_checks <specs-root> <spec-folder>
aide_spec_criteria_checks() {
  local file="$1/$2/1-description.md"
  [ -f "$file" ] || return 0
  sed -n 's/^[[:space:]]*-[[:space:]]*\*\*Acceptance criteria checks:\*\*[[:space:]]*//p' "$file" \
    | head -1 | sed 's/[[:space:]]*$//'
}

# Record the level a create chose: drop any "Acceptance criteria checks:"
# line in the description, and write the new one directly after its
# "Created:" line. Fails, writing nothing, when there is no Created line.
#   aide_spec_record_criteria_checks <description-file> <level>
aide_spec_record_criteria_checks() {
  local file="$1" level="$2" tmp
  [ -f "$file" ] || return 1
  grep -q '^[[:space:]]*-[[:space:]]*\*\*Created:\*\*' "$file" || return 1
  tmp="$(mktemp "${file}.XXXXXX")" || return 1
  awk -v line="- **Acceptance criteria checks:** $level" '
    /^[[:space:]]*-[[:space:]]*\*\*Acceptance criteria checks:\*\*/ { next }
    { print }
    !done && /^[[:space:]]*-[[:space:]]*\*\*Created:\*\*/ { print line; done = 1 }
  ' "$file" > "$tmp" || { rm -f "$tmp"; return 1; }
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# Whether the spec asks to choose between the approaches its analysis
# finds: the value of the optional "Let me choose the approach:" line in its
# OWN 1-description.md, as written. Nothing for a missing file or line,
# which the caller reads as no.
#   aide_spec_choose_approach <specs-root> <spec-folder>
aide_spec_choose_approach() {
  local file="$1/$2/1-description.md"
  [ -f "$file" ] || return 0
  sed -n 's/^[[:space:]]*-[[:space:]]*\*\*Let me choose the approach:\*\*[[:space:]]*//p' "$file" \
    | head -1 | sed 's/[[:space:]]*$//'
}

# The description's "## Out of scope" section: its heading and every line
# up to the next level-1 or level-2 heading or a `---` line, as written,
# with trailing whitespace (a CR too) and trailing blank lines dropped.
# Nothing when there is none. The heading is recognised in any letter case.
#   aide_out_of_scope_section <description text>
aide_out_of_scope_section() {
  printf '%s\n' "$1" | awk '
    (/^##?[ \t]/ || /^---[ \t\r]*$/) && inside { exit }
    tolower($0) ~ /^##[ \t]+out of scope[ \t\r]*$/ { inside = 1 }
    inside { sub(/[ \t\r]+$/, ""); line[++n] = $0 }
    END { while (n > 0 && line[n] == "") n--; for (i = 1; i <= n; i++) print line[i] }
  '
}

# Record whether a create asked to choose the approach: drop any "Let me
# choose the approach:" line in the description, and write the new one
# directly after its "Acceptance criteria checks:" line, or after its
# "Created:" line when there is none. Fails, writing nothing, when there is
# no Created line.
#   aide_spec_record_choose_approach <description-file> <yes|no>
aide_spec_record_choose_approach() {
  local file="$1" value="$2" anchor tmp
  [ -f "$file" ] || return 1
  grep -q '^[[:space:]]*-[[:space:]]*\*\*Created:\*\*' "$file" || return 1
  anchor='Created'
  grep -q '^[[:space:]]*-[[:space:]]*\*\*Acceptance criteria checks:\*\*' "$file" && anchor='Acceptance criteria checks'
  tmp="$(mktemp "${file}.XXXXXX")" || return 1
  awk -v line="- **Let me choose the approach:** $value" -v anchor="**$anchor:**" '
    /^[[:space:]]*-[[:space:]]*\*\*Let me choose the approach:\*\*/ { next }
    { print }
    !done && /^[[:space:]]*-[[:space:]]*\*\*/ && index($0, anchor) { print line; done = 1 }
  ' "$file" > "$tmp" || { rm -f "$tmp"; return 1; }
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# The three files a work round fills in — 2-analysis.md, 3-solution.md
# and 4-status.md — written fresh from the templates in
# core/skills/aide-create/references/file-templates.md. One writer for
# create (a new spec) and aide-reset-spec (a spec whose round must not count):
# 0-README.md and 1-description.md are never touched here.
# Usage: aide_write_placeholder_files <dest-dir> <title> <folder>
aide_write_placeholder_files() {
local dest="$1" title="$2" folder="$3"
  cat > "$dest/2-analysis.md" <<AIDE_EOF
# ${title} - Analysis

## Table of contents

- [Tracking info](#tracking-info)
- [Mapping](#mapping)
- [Findings](#findings)

---

## Tracking info

- **Task:** \`${folder}/\`
- **Last analyzed:** \`[not analyzed yet]\`

---

## Mapping

*(Filled in by /aide-analyze: search terms, methods, tools used to locate affected code.)*

---

## Findings

### Affected files

*(Filled in by /aide-analyze.)*

### Codebase analysis

*(Filled in by /aide-analyze.)*

### Affected components

*(Filled in by /aide-analyze.)*

### Patterns

*(Filled in by /aide-analyze.)*

### Test coverage

*(Filled in by /aide-analyze.)*

### API dependencies

*(Filled in by /aide-analyze.)*
AIDE_EOF

  cat > "$dest/3-solution.md" <<AIDE_EOF
# ${title} - Solution

## Table of contents

- [Tracking info](#tracking-info)
- [Scope](#scope)
- [Approaches](#approaches)
- [Recommended solution](#recommended-solution)
- [Behavior delta](#behavior-delta)
- [Acceptance criteria](#acceptance-criteria)
- [Risk analysis](#risk-analysis)
- [Implementation plan](#implementation-plan)
- [Testing](#testing)

---

## Tracking info

- **Task:** \`${folder}/\`
- **Last updated:** \`[not prepared yet]\`

---

## Scope

*(Filled in by /aide-analyze: files to change, complexity level and
factors, estimate.)*

---

## Approaches

*(Filled in by /aide-analyze: at least 2 approaches with pros/cons/estimate.)*

---

## Recommended solution

*(Filled in by /aide-analyze: before/after examples, in separate code blocks.)*

---

## Behavior delta

*(Filled in by /aide-analyze: what the solution adds, modifies and removes.)*

---

## Acceptance criteria

*(Filled in by /aide-analyze: testable given/when/then scenarios.)*

---

## Risk analysis

*(Filled in by /aide-analyze: risks with consequence/probability/mitigation.)*

---

## Implementation plan

*(Filled in by /aide-analyze: TDD Red-Green-Verify, 4 phases.)*

---

## Testing

*(Filled in by /aide-analyze: unit, integration, e2e, and a manual testing note.)*
AIDE_EOF

  cat > "$dest/4-status.md" <<AIDE_EOF
# ${title} - Status

Total progress: 0% (0 of X completed)
Estimate: [X hours/days]

## Table of contents

1. [Tracking info](#tracking-info)
2. [Phase 1: RED](#phase-1-red)
3. [Phase 2: GREEN](#phase-2-green)
4. [Phase 3: GREEN](#phase-3-green)
5. [Phase 4: VERIFY](#phase-4-verify)
6. [Notation](#notation)

## Tracking info

- **Task:** \`${folder}/\`
- **Last updated:** \`[not started]\`

## Phase 1: RED

| Task | Status | Notes |
|------|--------|-------|

## Phase 2: GREEN

| Task | Status | Notes |
|------|--------|-------|

## Phase 3: GREEN

| Task | Status | Notes |
|------|--------|-------|

## Phase 4: VERIFY

| Task | Status | Notes |
|------|--------|-------|

## Notation

- Not started
- In progress
- Completed
- Blocked
- Waiting
AIDE_EOF
}

# The content hash of a working tree as it stands — tracked and untracked
# files alike, ignored ones left out — independent of what is committed
# or staged. Two trees with the same hash hold the same files, so a test
# run recorded against one is a run against the other. Built in a
# throwaway index so the caller's own index is never touched.
#
# The project's worktree links (`worktreeLinks`, the same list a run
# links in — `.aide/config`'s older AIDE_WORKTREE_LINKS is legacy and is
# never read) are left out, committed or not. They are the gitignored paths a run points
# at the main checkout, a `node_modules/` ignore rule does not match the
# symlink that stands in for one, and a session's own `git add -A` can
# commit it — so counted, the tree a run tested differed from the tree
# that landed with nothing else between them (spec 480's archive,
# 2026-09-18), and the same tree hashed before and after a commit came
# out different. A caller whose checkout does not carry the list — a
# fresh worktree has no `.aide/config` — passes it as the second
# argument; with none, the checkout's own files are read.
#
# An untracked `.aide/project.yaml` is left out as well (spec 512), unless
# HEAD has it.
#   aide_tree_hash <dir> [links]
aide_tree_hash() {
  local dir="$1" given_links="${2:-}" idx
  idx="$(mktemp)" || return 1
  rm -f "$idx"
  (
    cd "$dir" || exit 1
    export GIT_INDEX_FILE="$idx"
    git read-tree HEAD >/dev/null 2>&1 || true
    git add -A . >/dev/null 2>&1 || exit 1
    links="$given_links"
    [ -n "$links" ] || links="$(aide_manifest_get worktreeLinks .)"
    for link in $links; do
      git rm -r -q --cached --ignore-unmatch -- "$link" >/dev/null 2>&1 || true
    done
    # An untracked manifest is the dashboard's derived copy of its own
    # settings (spec 512), copied into a worktree and kept out of the
    # commit — so it is not part of the tree that lands either. One the
    # commit already has stays.
    if ! git cat-file -e HEAD:.aide/project.yaml >/dev/null 2>&1; then
      git rm -q --cached --ignore-unmatch -- .aide/project.yaml >/dev/null 2>&1 || true
    fi
    git write-tree
  )
  local rc=$?
  rm -f "$idx"
  return "$rc"
}
