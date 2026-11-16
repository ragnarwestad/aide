# shellcheck shell=bash
aide_create_spec_stamp_outcome() {
# Patches an already-created 1-description.md's Tracking info with this
# phase's own Model/Time spent — the interactive counterpart to
# aide-run-spec's own "outcome record" block, which only
# ever runs for a headless create. See core/skills/aide-create/SKILL.md
# Step 5.
[ -n "$folder" ] || aide_spec_refuse "missing --folder"
[[ "$start_epoch" =~ ^[0-9]+$ ]] || aide_spec_refuse "missing or invalid --start-epoch"

target=""
for candidate in "$specs_root/$folder/1-description.md" \
                 "$specs_root/archive/$folder/1-description.md"; do
  [ -f "$candidate" ] && { target="$candidate"; break; }
done
[ -n "$target" ] || aide_spec_refuse "spec file not found: $folder/1-description.md"
grep -q '^## Tracking info' "$target" || aide_spec_refuse "no Tracking info heading in $target"

# The stamp itself is shared with aide-record-step (lib/tracking-info.sh):
# idempotent, it strips any existing Model/Time spent bullet from the
# section and inserts fresh ones right after the heading.
time_spent="$(session_time_spent "$start_epoch")" || aide_spec_refuse "--start-epoch is in the future"
stamp_model_and_time_spent "$target" "$model" "$time_spent" "Model|Time spent" \
  || aide_spec_refuse "could not stamp $target"

aide_spec_emit_ok "$(jq -cn --arg f "$folder" '{terminalReason:"stamped", specFolder:$f}')"
}
