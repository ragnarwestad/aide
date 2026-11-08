/** A stand-in for aide-record-test-run around `body`, shell that prints a
 *  run's output and exits with its code. It answers as the recorder does:
 *  the output, then one JSON line that, for a red run, carries the failing
 *  tests read by the recorder's own parser (core/scripts/lib/failing-tests.sh).
 *  A line the body prints itself is kept, with the failing tests added. */
export function namingRecorder(body: string): string {
  const lib = new URL("../../../core/scripts/lib/failing-tests.sh", import.meta.url).pathname;
  return `#!/bin/bash
out="$(mktemp)"
( ${body}
) > "$out" 2>&1
rc=$?
grep -v '^{"ok":' "$out"
source "${lib}"
line="$(grep '^{"ok":' "$out" | tail -1)"
[ -n "$line" ] || line="{\\"ok\\":true,\\"exitCode\\":$rc,\\"terminalReason\\":\\"recorded\\"}"
if [ "$rc" -ne 0 ]; then jq -c --argjson f "$(failing_tests "$out")" '. + {failingTests:$f}' <<<"$line"; else printf '%s\\n' "$line"; fi
rm -f "$out"
exit $rc
`;
}
