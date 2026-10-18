#!/usr/bin/env bash
# run-spec/turn/model-marks.sh — sourced by aide-run-spec before run-spec/turn/model-turn.sh.
#
# The model's own step marks, dated as they appear. While a model turn runs,
# run_model_turn (run-spec/turn/model-turn.sh) calls model_marks_record each
# time it polls; it reads the transcript's new bytes, picks out the lines
# the model wrote as marks (`--- Step N of X: <title> — started|done|skipped|stopped`)
# and writes each into the run log through stage_line, so it carries the run's
# clock like every other line there. The stream of the three tools has no clock
# of its own that they share; the moment the runner sees the line is the one.
#
# Which lines are marks is decided twice, here and in `splitMarks`
# (dashboard/src/queue/parse-stream/shared.ts); core/tests/fixtures/model-marks.json
# pins both. Nothing here can fail a turn: every command is guarded.

# The most a poll reads. A line past it is a tool result, never a mark, and
# is skipped to its newline rather than stalling the recording of what follows.
MODEL_MARKS_CAP=1048576

# Where the model's text sits, per tool, and which of its lines are marks.
# shellcheck disable=SC2016  # a jq program, not shell
MODEL_MARKS_JQ='
  fromjson? | select(type == "object")
  | (if $tool == "codex" then
       select(.type == "item.completed") | .item | select((.item_type // .type) == "agent_message") | .text
     elif $tool == "opencode" then
       select(.part.type? == "text") | .part.text
     else
       select(.type == "assistant" and (.parent_tool_use_id // null) == null)
       | .message.content[]? | select(.type == "text") | .text
     end)
  | strings | split("\n")[]
  | gsub("^\\s+|\\s+$"; "") | gsub("^[`*]+|[`*]+$"; "")
  | select(test("^--- Step [0-9]+ of [0-9]+: .+ — (started|done|skipped|stopped)\\b"))'

# A turn starts reading at the transcript's size when it started, so a second
# or third turn of one step never records the first turn's marks again.
model_marks_begin() {   # <byte the turn's output begins at>
  marks_at="${1:-0}"
  marks_skip=""
}

# Bytes of file $1 up to and including its last newline, 0 when it has none.
_marks_whole_bytes() {
  local total partial
  total="$({ wc -c < "$1"; } 2>/dev/null | tr -d ' ')"
  [ "${total:-0}" -gt 0 ] || { echo 0; return 0; }
  if [ "$(tail -c 1 "$1" 2>/dev/null | od -An -tx1 | tr -d ' ')" = "0a" ]; then
    echo "$total"
    return 0
  fi
  partial="$(tail -n 1 "$1" 2>/dev/null | wc -c | tr -d ' ')"
  echo $(( total - ${partial:-0} ))
}

# Bytes of file $1's first line with its newline, 0 when the file holds no newline.
_marks_first_line_bytes() {
  if [ "$(head -n 1 "$1" 2>/dev/null | tail -c 1 | od -An -tx1 | tr -d ' ')" = "0a" ]; then
    head -n 1 "$1" 2>/dev/null | wc -c | tr -d ' '
  else
    echo 0
  fi
}

# One read of the transcript's new bytes. Returns 0 when it moved on, so
# the final call can go on until the transcript is read to its end.
_marks_step() {   # [final]
  local final="${1:-}" size got whole skipped
  local chunk="$work_dir/marks.chunk" lines="$work_dir/marks.lines" mark
  size="$({ wc -c < "$transcript"; } 2>/dev/null | tr -d ' ')"
  [ "${size:-0}" -gt "${marks_at:-0}" ] || return 1
  tail -c +"$(( marks_at + 1 ))" "$transcript" 2>/dev/null | head -c "$MODEL_MARKS_CAP" > "$chunk" 2>/dev/null || true
  got="$({ wc -c < "$chunk"; } 2>/dev/null | tr -d ' ')"
  [ "${got:-0}" -gt 0 ] || return 1

  if [ -n "$marks_skip" ]; then
    skipped="$(_marks_first_line_bytes "$chunk")"
    if [ "${skipped:-0}" -eq 0 ]; then
      marks_at=$(( marks_at + got ))
    else
      marks_at=$(( marks_at + skipped ))
      marks_skip=""
    fi
    return 0
  fi

  whole="$(_marks_whole_bytes "$chunk")"
  # The last line of a finished turn has no newline to wait for.
  if [ "$final" = "final" ] && [ "$got" -lt "$MODEL_MARKS_CAP" ]; then
    whole="$got"
  fi
  if [ "${whole:-0}" -eq 0 ]; then
    if [ "$got" -ge "$MODEL_MARKS_CAP" ]; then
      marks_skip=1
      marks_at=$(( marks_at + got ))
      return 0
    fi
    return 1
  fi

  marks_at=$(( marks_at + whole ))
  head -c "$whole" "$chunk" > "$lines" 2>/dev/null || return 0
  # Most polls hold no mark at all; do not start jq for them.
  grep -aq 'Step [0-9]' "$lines" 2>/dev/null || return 0
  while IFS= read -r mark; do
    [ -n "$mark" ] && stage_line "$mark"
  done < <(jq -Rr --arg tool "$tool" "$MODEL_MARKS_JQ" "$lines" 2>/dev/null)
  return 0
}

# Record the marks the transcript has gained since the last read. `final`,
# after the turn has ended, reads to the end, an unfinished last line too.
model_marks_record() {   # [final]
  if [ "${1:-}" = "final" ]; then
    while _marks_step final; do :; done
  else
    _marks_step || true
  fi
  return 0
}
