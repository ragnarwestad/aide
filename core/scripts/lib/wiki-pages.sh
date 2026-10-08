#!/usr/bin/env bash
# wiki-pages.sh — sourced by aide-wiki once its arguments are read.
#
# Reading and writing one wiki page: its mark, legacy-section cleanup, and putting a page
# in place. It uses aide-wiki's own globals ($wiki, $project_dir, ...).

# --- the mark, read here and in dashboard/src/project/wiki/ ------------------

# The front matter's lines, without the two `---` fences; empty when the file
# does not start with one.
front_matter() {
  awk 'NR==1 { if ($0 != "---") exit; next } $0 == "---" { exit } { print }' "$1" 2>/dev/null
}

front_matter_of_text() {
  awk 'NR==1 { if ($0 != "---") exit; next } $0 == "---" { exit } { print }'
}

is_generated() {
  front_matter "$1" | grep -qx 'wiki: generated'
}

fm_commit() {
  front_matter "$1" | sed -n 's/^commit: *//p' | head -1
}

fm_files() {
  front_matter "$1" | awk '/^files:/ { on = 1; next } on && /^  - / { sub(/^  - /, ""); print; next } { on = 0 }'
}

# The body: what follows the front matter (all of the file when it has none).
body_of() {
  awk 'NR==1 && $0 != "---" { body = 1 } body { print; next } NR>1 && $0 == "---" { body = 1; next }' "$1"
}

page_title() {
  local t
  t="$(body_of "$1" | sed -n 's/^# \{1,\}//p' | head -1)"
  [ -n "$t" ] || t="$(basename "$1" .md)"
  printf '%s' "$t"
}

# The first non-empty line after the `# ` heading.
page_summary() {
  body_of "$1" | awk '/^# / && !seen { seen = 1; next } seen && NF { print; exit }'
}

need_project() {
  [ -n "$project_dir" ] || refuse "missing-argument" "missing --project-dir"
  git -C "$project_dir" rev-parse HEAD >/dev/null 2>&1 || refuse "no-project" "$project_dir is not a git repository with a commit"
  head_sha="$(git -C "$project_dir" rev-parse HEAD)"
}

# A generated page's text: the mark, the commit, the files, then the body on stdin.
compose() {
  local commit="$1"; shift
  printf -- '---\nwiki: generated\ncommit: %s\n' "$commit"
  if [ $# -eq 0 ]; then
    printf 'files: []\n'
  else
    printf 'files:\n'
    local f
    for f in "$@"; do printf '  - %s\n' "$f"; done
  fi
  printf -- '---\n\n'
  cat
}

# Overwrite $1 with stdin, but never a hand-written page.
put_page() {
  local target="$1" tmp
  if [ -e "$target" ] && ! is_generated "$target"; then
    cat >/dev/null
    refuse "hand-written-page" "$(basename "$target") is written by hand (no wiki: generated mark) and is left as it is"
  fi
  mkdir -p "$wiki"
  tmp="$(mktemp)"
  cat > "$tmp"
  mv "$tmp" "$target"
}

# put_page for the index and the schema, which name no files: their
# commit stamp says nothing about them, so a text that is the same but
# for that stamp leaves the page as it is — two runs restamping it would
# otherwise collide on that one line when both land.
put_page_unless_same() {
  local target="$1" tmp
  tmp="$(mktemp)"
  cat > "$tmp"
  if [ -f "$target" ] && is_generated "$target" \
     && [ "$(grep -v '^commit: ' "$target")" = "$(grep -v '^commit: ' "$tmp")" ]; then
    rm -f "$tmp"
    return 0
  fi
  put_page "$target" < "$tmp"
  local rc=$?
  rm -f "$tmp"
  return $rc
}

# The project's default branch, resolved the same way
# core/scripts/lib/run-spec/setup/gates.sh's own default_branch() does — that
# function lives in a bash-runner-internal library neither a plain script
# call nor the archive skill's own session (a separate AI-CLI process)
# can reach, so this is its own small copy of the same fallback.
default_branch_of() {
  local root="$1" ref candidate
  ref="$(git -C "$root" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"
  if [ -n "$ref" ]; then
    echo "${ref#origin/}"
    return
  fi
  for candidate in main master; do
    git -C "$root" show-ref --verify --quiet "refs/heads/$candidate" && { echo "$candidate"; return; }
  done
  git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null
}
