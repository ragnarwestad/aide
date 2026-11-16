# shellcheck shell=bash
aide_create_spec_create() {
# --number is OPTIONAL: given, it is used as stated; omitted, this
# script picks it, and picking it HERE is what lets two creates run at
# once. Read-then-write from two sessions reads the same highest number
# and writes the same folder — which is why the round had to send its
# fixture specs one at a time. `mkdir` settles it instead: the loser of
# the race takes the next free number and tries again.
#
# --folder-name is a THIRD shape, for a headless run whose real number
# is not decided here at all any more: the caller already
# has a unique name (the job's own provisional key), so there is
# nothing to race over and no lock to take — `--number`'s validation
# and the auto-pick lock below are both skipped entirely.
[ -n "$title" ] || aide_spec_refuse "missing --title"
[ -n "$folder_name" ] || [ -n "$slug" ] || slug="$(aide_slug_from_title "$title")"
[ -n "$description" ] || aide_spec_refuse "missing --description"

if [ "$depends_on_given" = "yes" ] && [ -n "$depends_on" ]; then
  resolved_dependencies=()
  while IFS= read -r dependency; do
    dependency="$(printf '%s' "$dependency" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -n "$dependency" ] || continue
    resolved="$(aide_resolve_dependency_folder "$specs_root" "$dependency")"
    [ -n "$resolved" ] || aide_spec_refuse "unknown or ambiguous dependency: $dependency"
    resolved_dependencies+=("$resolved")
  done < <(printf '%s\n' "$depends_on" | tr ',' '\n')
  depends_on="$(printf '%s\n' "${resolved_dependencies[@]}" | paste -sd, -)"
fi

# The rule's own definition of an acceptance-criteria line
# (core/rules/spec-structure.md § 1-description) is
# `^- \*\*AC-\d+:\*\*`. A line whose bold markers are missing or
# misplaced around "AC-n:" is rewritten to that shape rather than
# refused: there is one right way to write it, and a refusal leaves the
# person with no spec to correct. Only what the rewrite cannot reach is
# still refused below, detected by stripping every `*` from the line
# and checking for a bare "- AC-n:" shape underneath. A line that
# survives stripping unmatched is ordinary text and is never touched.
AC_BOLD='s/^- \**AC-([0-9]+)\**:\**[[:space:]]*/- **AC-\1:** /'
bolded="$(printf '%s\n' "$description" | sed -E "$AC_BOLD")"
[ "$bolded" = "$(printf '%s\n' "$description")" ] || description="$bolded"
while IFS= read -r ac_line; do
  stripped="${ac_line//\*/}"
  case "$stripped" in
    "- AC-"[0-9]*":"*)
      case "$ac_line" in
        "- **AC-"[0-9]*":**"*) : ;;
        *) aide_spec_refuse "Acceptance criteria line does not match the required '- **AC-n:** ...' format: \"$ac_line\"" ;;
      esac
      ;;
  esac
done <<AC_CHECK_EOF
$description
AC_CHECK_EOF

# --given-description: the criteria it gives are the person's own. Each
# must be in --description word for word, and every criterion added must
# take the next id after the highest one given, with no gap and no id
# written more often than the given description has it. Both texts go through the same bold rewrite before they
# are compared. A given line the rewrite cannot reach still counts as
# given, by the shape check's own match, but is not compared: its format
# had to change. Only a criterion's first line is compared, since the
# rule writes one sentence per id.
if [ "$given_set" = "yes" ]; then
  ac_lines() { printf '%s\n' "$1" | sed -E "$AC_BOLD" | grep -E '^- \*\*AC-[0-9]+:\*\*' | sed -E 's/[[:space:]]+$//'; }
  ac_id() { local rest="${1#- \*\*AC-}"; printf '%s\n' "$((10#${rest%%:*}))"; }
  given_ids=" "; given_highest=0; given_id_list=""
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    given_ids="$given_ids$((10#$n)) "
    given_id_list="$given_id_list$((10#$n))"$'\n'
    [ "$((10#$n))" -gt "$given_highest" ] && given_highest="$((10#$n))"
  done <<<"$(printf '%s\n' "$given_description" | tr -d '*' | sed -nE 's/^- AC-([0-9]+)[^:]*:.*/\1/p')"
  written_lines="$(ac_lines "$description")"
  written_ids="$(while IFS= read -r l; do [ -n "$l" ] && ac_id "$l"; done <<<"$written_lines" | sort -n)"
  for twice in $(uniq -d <<<"$written_ids"); do
    [ "$(grep -cx -- "$twice" <<<"$written_ids")" -gt "$(grep -cx -- "$twice" <<<"$given_id_list")" ] \
      && aide_spec_refuse "AC-$twice appears twice: every criterion keeps an id of its own"
  done
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    id="$(ac_id "$line")"
    grep -qx -- "$id" <<<"$written_ids" || aide_spec_refuse "AC-$id is missing: every criterion the description gave must stay in it"
    grep -qxF -- "$line" <<<"$written_lines" || aide_spec_refuse "AC-$id must stay word for word as the description gave it: \"$line\""
  done <<<"$(ac_lines "$given_description")"
  next=$((given_highest + 1))
  for id in $written_ids; do
    case "$given_ids" in *" $id "*) continue ;; esac
    if [ "$id" -ne "$next" ]; then
      [ "$given_highest" -eq 0 ] && [ "$next" -eq 1 ] && aide_spec_refuse "AC-$id is not the next id: the first criterion takes AC-1"
      aide_spec_refuse "AC-$id is not the next id: a criterion added after AC-$((next - 1)) takes AC-$next"
    fi
    next=$((next + 1))
  done
  # The "## Out of scope" section is the person's own too: kept word for
  # word, and never written by the model. The criteria added directly
  # after the last given one may stand inside it, so the written side
  # leaves them out; both sides go through the same bold rewrite.
  without_added() { printf '%s\n' "$1" | awk -v ids="$given_ids" '
    function given(s,  n) { if (s !~ /^- \*\*AC-[0-9]+:\*\*/) return -1; n = s; sub(/^- \*\*AC-/, "", n); sub(/:.*/, "", n); return index(ids, " " (n + 0) " ") > 0 }
    { l[NR] = $0; if (given($0) == 1) last = NR }
    END { i = last + 1; if (last) while (i <= NR && given(l[i]) == 0) i++; for (j = 1; j <= NR; j++) if (j <= last || j >= i) print l[j] }'; }
  if declare -f aide_out_of_scope_section >/dev/null 2>&1; then
    given_scope="$(aide_out_of_scope_section "$(printf '%s\n' "$given_description" | sed -E "$AC_BOLD")")"
    written_scope="$(aide_out_of_scope_section "$(without_added "$description")")"
    if [ -n "$given_scope" ] && [ "$given_scope" != "$written_scope" ]; then
      aide_spec_refuse "the ## Out of scope section must stay word for word as the description gave it"
    elif [ -z "$given_scope" ] && [ -n "$written_scope" ]; then
      aide_spec_refuse "the description gave no ## Out of scope section: only its author writes one"
    fi
  fi
fi

if [ -n "$folder_name" ]; then
  [[ "$folder_name" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || aide_spec_refuse "invalid --folder-name: $folder_name"
  folder="$folder_name"
  dest="$specs_root/$folder"
  [ -d "$dest" ] && aide_spec_refuse "spec folder already exists: $dest"
elif [ -n "$number" ]; then
  # A number handed in must lie above every number already there — a
  # spec number is never reused, and a caller
  # that counted wrong — a session that sorted the archive's folder
  # names alphabetically and read "99-…" as the highest, then asked for
  # 100, which an archived spec already had (2026-09-10) — must be
  # refused, not obeyed. Skipped only where the helper is missing, so a
  # bare copy of the script still creates what it is asked to.
  if declare -f aide_next_spec_number >/dev/null 2>&1; then
    expected="$(aide_next_spec_number "$specs_root")"
    highest="$(( 10#$expected - 1 ))"
    if [ "$((10#$number))" -le "$highest" ]; then
      aide_spec_refuse "spec number $number is already taken — the highest under $specs_root (and its archive/) is $highest, so the next is $expected"
    fi
  fi
  folder="${number}-${slug}"
  dest="$specs_root/$folder"
  [ -d "$dest" ] && aide_spec_refuse "spec folder already exists: $dest"
else
  declare -f aide_next_spec_number >/dev/null 2>&1 \
    || aide_spec_refuse "_aide-spec-lib.sh is missing beside aide-create-spec — reinstall aide, or pass --number"
  # The lock has to be on the NUMBER, not on the folder: two creates
  # with different slugs make different directories at the same number,
  # so `mkdir "$dest"` locks nothing. `mkdir` of one shared name does —
  # it is atomic, and it fails for whoever is second.
  #
  # Held for the few milliseconds it takes to read the highest number
  # and make the folder, which is what has to be indivisible. Removed on
  # every exit path below, and broken when it is older than a minute:
  # a run killed mid-claim must not stop every later one.
  lock="$specs_root/.aide-create.lock"
  claimed=""
  for _ in $(seq 1 100); do
    if mkdir "$lock" 2>/dev/null; then
      number="$(aide_next_spec_number "$specs_root")"
      folder="${number}-${slug}"
      dest="$specs_root/$folder"
      if [ -d "$dest" ]; then
        rmdir "$lock" 2>/dev/null
        aide_spec_refuse "spec folder already exists: $dest"
      fi
      mkdir "$dest" 2>/dev/null || { rmdir "$lock" 2>/dev/null; aide_spec_refuse "could not create $dest"; }
      rmdir "$lock" 2>/dev/null
      claimed="yes"
      break
    fi
    # A lock nobody is holding any more: whoever made it is gone.
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
      rmdir "$lock" 2>/dev/null
    fi
    sleep 0.1
  done
  [ -n "$claimed" ] || aide_spec_refuse "could not claim a spec number under $specs_root — $lock is held"
fi

today="$(date -u +%Y-%m-%d)"

depends_line=""
if [ "$depends_on_given" = "yes" ] && [ -n "$depends_on" ]; then
  # paste -sd cycles through a multi-character delimiter one character
  # per join, rather than repeating the whole string — so ", " would
  # come out as a bare "," between every pair. Joined with a single
  # comma instead, then widened to ", " afterwards.
  # shellcheck disable=SC2016  # the backticks are markdown, matched as they are
  formatted="$(printf '%s' "$depends_on" | tr ',' '\n' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' \
    | sed 's/^/`/; s/$/`/' | paste -sd, - | sed 's/,/, /g')"
  [ -n "$formatted" ] && depends_line=$'\n- **Depends on:** '"$formatted"
fi

accept_line=""
[ "$acceptance_not_required" = "yes" ] && accept_line=$'\n- **Acceptance:** not required'
criteria_line=""
[ -n "$criteria_checks" ] && criteria_line=$'\n- **Acceptance criteria checks:** '"$criteria_checks"
approach_line=""
[ -n "$choose_approach" ] && approach_line=$'\n- **Let me choose the approach:** '"$choose_approach"

# Already made above when this run claimed its own number; `-p` is what
# makes that case a no-op rather than a second, failing create.
mkdir -p "$dest" || aide_spec_refuse "could not create $dest"

# The heredoc delimiter below is deliberately unquoted (<<AIDE_EOF, not
# <<'AIDE_EOF') so ${title}/${folder}/${today}/${depends_line}/
# ${description} are substituted. This is safe: bash performs parameter
# expansion exactly once, over the heredoc's own literal template text —
# a substituted value is inserted as data and is never re-scanned for
# further expansion. A description containing backticks or $(...) is
# written out verbatim, not executed (the same reason
# `x='$(cmd)'; echo "$x"` prints text instead of running cmd — bash does
# not double-evaluate; eval exists precisely because ordinary
# substitution never does this). Literal backticks that belong to the
# template itself (not to a substituted value) are escaped as \` so an
# unquoted heredoc does not read them as command substitution.

cat > "$dest/0-README.md" <<AIDE_EOF
# Documentation

## Table of contents

1. [Description](1-description.md) - Tracking info and the problem
2. [Analysis](2-analysis.md) - Mapping and findings
3. [Solution](3-solution.md) - Scope, plan, criteria and risk
4. [Status](4-status.md) - Progress tracking
AIDE_EOF

cat > "$dest/1-description.md" <<AIDE_EOF
# ${title} - Description

## Table of contents

- [Tracking info](#tracking-info)
- [Description](#description)

---

## Tracking info

- **Task:** \`${folder}/\`
- **Created:** \`${today}\`${depends_line}${accept_line}${criteria_line}${approach_line}

---

## Description

${description}

*This description can be edited before /aide-analyze runs.*
AIDE_EOF

aide_write_placeholder_files "$dest" "$title" "$folder"

aide_spec_emit_ok "$(jq -cn --arg f "$folder" --argjson files '["0-README.md","1-description.md","2-analysis.md","3-solution.md","4-status.md"]' \
  '{terminalReason:"created", specFolder:$f, files:$files}')"
}
