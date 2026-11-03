# translation-files.sh — the project's translation files: which files
# they are (`translationFiles` in .aide/project.yaml) and the git arguments
# that merge them key by key (aide-merge-translation).
#
# Sourced after _aide-spec-lib.sh, whose aide_manifest_get this reads with.

# The project's translation files (`translationFiles` in
# .aide/project.yaml: space-separated gitattributes patterns, such as
# `packages/i18n/messages/*.json`) as a gitattributes file at <out>, one
# `<pattern> merge=aide-translation` line each. Returns 1, writing nothing,
# when the project names none.
#
# The one matcher for these files: a merge reads this file to pick
# aide-merge-translation as the driver (aide_translation_merge_args), and
# aide-spec-overlap asks `git check-attr` of the same file which shared
# files are translation files — so the two can never disagree about which
# files those are.
# Usage: aide_translation_attributes <project-root> <out>
aide_translation_attributes() {
  local root="$1" out="$2" value pattern
  local -a patterns
  value="$(aide_manifest_get translationFiles "$root")"
  # read -a splits without expanding a pattern against the current directory.
  read -r -a patterns <<<"$value"
  [ "${#patterns[@]}" -gt 0 ] || return 1
  : > "$out" || return 1
  for pattern in "${patterns[@]}"; do
    printf '%s merge=aide-translation\n' "$pattern" >> "$out"
  done
}

# The `git -c` arguments that make a merge in <project-root>'s repository
# merge its translation files with aide-merge-translation, one per line,
# for `git "${args[@]}" merge …`. Prints nothing when the project names no
# translation files, so a merge then runs exactly as before. <dir> is where
# the attributes file is kept for the merge's lifetime.
#
# core.attributesFile is the per-command way to give git attributes: the
# repository's own .gitattributes and info/attributes are shared with the
# person's checkout and every other worktree, and this setting must reach
# this one merge and nothing else.
# Usage: aide_translation_merge_args <project-root> <dir> <scripts-dir>
aide_translation_merge_args() {
  local root="$1" dir="$2" scripts="$3"
  aide_translation_attributes "$root" "$dir/translation-attributes" || return 0
  printf '%s\n' -c "core.attributesFile=$dir/translation-attributes" \
    -c "merge.aide-translation.driver='$scripts/aide-merge-translation' %O %A %B %L %P"
}
