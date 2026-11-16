# shellcheck shell=bash
aide_create_spec_assign_number() {
# Landing's own finalize step: a create job's folder exists
# only under its literal provisional key (`new-<8 hex>`) until this
# runs, under the specs repo's own merge lock, where two landings for
# the same repo are already serialized by construction — the one place
# two concurrent creates cannot collide over a number. Reuses
# aide_next_spec_number/aide_slug_from_title, the same two functions
# every other caller in this file already shares (the invariant:
# one rule, one place) — never a second, hand-rolled count.
[ -n "$folder" ] || aide_spec_refuse "missing --folder"
src="$specs_root/$folder"
[ -d "$src" ] || aide_spec_refuse "no such spec folder: $src"
desc_file="$src/1-description.md"
[ -f "$desc_file" ] || aide_spec_refuse "missing $desc_file"
title_line="$(head -1 "$desc_file")"
case "$title_line" in
  "# "*" - Description") title="${title_line#\# }"; title="${title% - Description}" ;;
  *) aide_spec_refuse "cannot read a title from $desc_file's first line: $title_line" ;;
esac
declare -f aide_next_spec_number >/dev/null 2>&1 \
  || aide_spec_refuse "_aide-spec-lib.sh is missing beside aide-create-spec — reinstall aide"
number="$(aide_next_spec_number "$specs_root")"
slug="$(aide_slug_from_title "$title")"
new_folder="${number}-${slug}"
dest="$specs_root/$new_folder"
[ -d "$dest" ] && aide_spec_refuse "spec folder already exists: $dest"

# Refuse loudly rather than leave a stale Task: line behind (the risk
# a hand-edited Tracking info section would otherwise create): every
# file that is supposed to carry the line is checked BEFORE anything
# moves, so a refusal here leaves the folder exactly where it was.
old_task_line="- **Task:** \`${folder}/\`"
new_task_line="- **Task:** \`${new_folder}/\`"
for name in 1-description.md 2-analysis.md 3-solution.md 4-status.md; do
  f="$src/$name"
  [ -f "$f" ] || continue
  grep -qF -- "$old_task_line" "$f" \
    || aide_spec_refuse "no '$old_task_line' line in $f — refusing rather than leave a stale Task: line after the rename"
done

git -C "$specs_root" mv "$folder" "$new_folder" || aide_spec_refuse "could not git mv $folder to $new_folder"

for name in 1-description.md 2-analysis.md 3-solution.md 4-status.md; do
  f="$dest/$name"
  [ -f "$f" ] || continue
  awk -v old="$old_task_line" -v new="$new_task_line" \
    '{ if ($0 == old) print new; else print }' "$f" > "$f.assign-tmp" && mv "$f.assign-tmp" "$f"
done

# One commit, landing together with the merge that triggered it: the
# rename alone (from `git mv`, already staged) plus the Task: line
# rewrites above, which are not.
if ! { git -C "$specs_root" add -- "$new_folder" \
    && git -C "$specs_root" commit -q -m "Assign $new_folder its number"; }; then
  aide_spec_refuse "could not commit the rename of $folder to $new_folder"
fi

aide_spec_emit_ok "$(jq -cn --arg f "$new_folder" '{terminalReason:"assigned", specFolder:$f}')"
}
