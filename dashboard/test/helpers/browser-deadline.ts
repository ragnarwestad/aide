// The deadline every test that starts a real browser runs under.
//
// Each of those files used to name its own — 20 s in nineteen of them,
// 30 s in ten — and what they were all really allowing for is the same
// thing: a chromium launch, which takes what it takes when the suite is
// running several bun processes beside it. At 20 s a run that had been
// green twice lost sixteen tests to launches that were merely slow, and
// raising bun's own `--timeout` did nothing, because a file's own
// `setDefaultTimeout` is what wins.
//
// One value, one place, and `test/design/browser-tests-have-their-own-pool.test.ts`
// refuses a browser test that sets its own instead.

import { setDefaultTimeout } from "bun:test";

/** 60 s: the launch is the cost, and a test that needs longer than this
 *  is waiting for something that is not coming. */
export const BROWSER_DEADLINE_MS = 60_000;

export function browserDeadline(): void {
  setDefaultTimeout(BROWSER_DEADLINE_MS);
}

/** What one browser or page call may take before it is reported as a
 *  hang. Twelve files kept a copy of this wait with a number of their
 *  own — 10 s in most of them — and under a suite that runs several bun
 *  processes beside them a launch or a navigation reaches that honestly.
 *  Well under `BROWSER_DEADLINE_MS`, so a wedged call is still reported
 *  in its own words rather than as a bare test timeout. */
export const BROWSER_CALL_MS = 30_000;

/** A bounded wait around a browser or page call: a silent hang becomes a
 *  readable failure instead of a wedged suite. */
export function withBrowser<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not resolve within ${BROWSER_CALL_MS}ms`)), BROWSER_CALL_MS),
    ),
  ]);
}
