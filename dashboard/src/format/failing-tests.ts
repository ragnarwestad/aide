// Which tests a red run failed. aide-record-test-run reads them from the
// run's own output (`failing_tests` in core/scripts/lib/failing-tests.sh)
// and puts them on its answer as `failingTests`; this reads that answer.

/** Every failing test the output names, once, in order; the file each is
 *  in (`""` when the output does not say); `failed` whenever a test is
 *  named; `total` only when every runner that named one printed its count. */
export interface FailingTests {
  tests: string[];
  files: string[];
  errors: string[];
  failed?: number;
  total?: number;
}

const NONE: FailingTests = { tests: [], files: [], errors: [] };

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : undefined;
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The `failingTests` on the recorder's answer, its last JSON line on
 *  stdout. None named when there is no such line: a recorder that was
 *  stopped, or one installed before it named them. */
export function recordedFailures(stdout: string): FailingTests {
  const line = stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith('{"ok":')).at(-1);
  if (!line) return NONE;
  let raw: unknown;
  try {
    raw = (JSON.parse(line) as { failingTests?: unknown }).failingTests;
  } catch {
    return NONE;
  }
  if (raw === null || typeof raw !== "object") return NONE;
  const r = raw as Record<string, unknown>;
  const tests = strings(r.tests) ?? [];
  const files = strings(r.files);
  const errors = strings(r.errors);
  const failed = count(r.failed);
  const total = count(r.total);
  return {
    tests,
    files: files?.length === tests.length ? files : tests.map(() => ""),
    errors: errors?.length === tests.length ? errors : tests.map(() => ""),
    ...(failed !== undefined ? { failed } : {}),
    ...(total !== undefined ? { total } : {}),
  };
}

/** True when the second run failed a test the first did not. */
export function variedBetween(before: readonly string[], after: readonly string[]): boolean {
  const was = new Set(before);
  return after.some((t) => !was.has(t));
}
