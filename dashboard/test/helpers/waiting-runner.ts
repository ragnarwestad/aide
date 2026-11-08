// A runner that stays alive until the test has written its step's result,
// as a real one does. `/usr/bin/true` exits at once, and a runner poll
// that comes before the test's write reads the step as vanished — under
// load, often enough to time a test out. Written once per process: a
// fresh executable costs seconds on macOS.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WAITING_RUNNER = join(mkdtempSync(join(tmpdir(), "aide-waiting-runner-")), "runner.sh");
writeFileSync(
  WAITING_RUNNER,
  '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = --result-file ] && f="$2"; shift; done\n' +
    'i=0; while [ ! -f "$f" ] && [ $i -lt 400 ]; do sleep 0.05; i=$((i + 1)); done\n',
  { mode: 0o755 },
);
