// Which tests a red run failed, read from the run's own output, so a row
// names them rather than showing the last lines of the log.
//
// `failing_tests` in core/scripts/lib/run-spec/turn/failing-tests.sh reads
// a step's own run the same way; core/tests/fixtures/failing-tests.json
// pins both. What each runner prints, without its colour and cursor codes:
//   Playwright  "  2 failed", then one "[project] › file:line:col › title"
//               per test, then "  2 flaky", "  151 passed (5.8m)"
//   vitest      " FAIL  file > suite > name", and "Tests  2 failed | 40 passed (42)"
//   bun         a "file.test.ts:" heading, "(fail) suite > name [5ms]", " 40 pass", " 2 fail"
//   pytest      "FAILED path::name - message", "ERROR path::name - …", "1 failed, 40 passed in 3s"
//   turbo       each line prefixed "@pkg:task: ", and "Failed:    @pkg#task"
// A turbo task stands for its tests only when no test was named.

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

const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]|\r/g;
const TURBO_FAILED = /^Failed: +[^ ]+#[^ ]+ *$/;
const TURBO_PREFIX = /^[@A-Za-z0-9_./-]+:[A-Za-z0-9_.:-]+: /;
const ERROR_LINE = /^(?:[A-Za-z]*Error: |Test timeout of .* exceeded\.$)/;

/** The number in front of ` <word>` in `s`, or undefined. */
function count(s: string, word: string): number | undefined {
  const m = new RegExp(`([0-9]+) ${word}`).exec(s);
  return m ? Number(m[1]) : undefined;
}

type Kind = "playwright" | "vitest" | "bun" | "pytest" | "turbo";

export function failingTests(output: string): FailingTests {
  let lines = output.replace(ESCAPES, "").split("\n");
  // Only in a turbo run: elsewhere "path:12: Error" is no prefix.
  if (lines.some((l) => TURBO_FAILED.test(l))) lines = lines.map((l) => l.replace(TURBO_PREFIX, ""));
  const tests: string[] = [];
  const files: string[] = [];
  const errors: string[] = [];
  const kinds: Kind[] = [];
  const indexes = new Map<string, number>();
  const add = (kind: Kind, test: string, file: string, error = ""): number | undefined => {
    const key = `${test}\0${file}`;
    if (!test) return undefined;
    const existing = indexes.get(key);
    if (existing !== undefined) return existing;
    tests.push(test);
    files.push(file);
    errors.push(error);
    kinds.push(kind);
    const index = tests.length - 1;
    indexes.set(key, index);
    return index;
  };
  const pw = { seen: false, failed: 0, flaky: 0, passed: 0 };
  const vt = { seen: false, failed: 0, passed: 0 };
  const py = { seen: false, failed: 0, passed: 0 };
  const bun = { passLines: 0, failLines: 0, passed: 0, failed: 0 };
  const bare: string[] = [];
  const withFile = new Set<string>();
  const tasks: string[] = [];
  let pwList = false;
  let bunFile = "";
  let bunError = "";
  const pendingVitest = new Set<number>();
  const playwrightErrors = new Map<string, string>();
  let playwrightTest = "";
  for (const raw of lines) {
    const line = raw.trim();
    const block = /^[0-9]+\) (.*)$/.exec(line);
    if (block) {
      let s = block[1]!;
      const project = /\[[^\]]*\] › /.exec(s);
      if (project) s = s.slice(project.index + project[0].length);
      const match = /^([^ ]+):([0-9]+):[0-9]+ › (.*?)(?: ─+)?$/.exec(s);
      playwrightTest = match ? `${match[1]}:${match[2]} › ${match[3]!.trim()}` : "";
      continue;
    }
    if (playwrightTest && ERROR_LINE.test(line)) {
      if (!playwrightErrors.has(playwrightTest)) playwrightErrors.set(playwrightTest, line);
      playwrightTest = "";
      continue;
    }
    if (pwList) {
      let s = line;
      const project = /\[[^\]]*\] › /.exec(s);
      if (project) s = s.slice(project.index + project[0].length);
      const m = /^([^ ]+):([0-9]+):[0-9]+ › (.*)$/.exec(s);
      if (m) {
        const test = `${m[1]}:${m[2]} › ${m[3]!.replace(/ \(retry #[0-9]+\)$/, "").trim()}`;
        add("playwright", test, m[1]!, playwrightErrors.get(test));
        continue;
      }
      pwList = false;
    }
    if (/(^|[ :])[0-9]+ failed$/.test(line)) {
      pw.seen = true;
      pw.failed += count(line, "failed")!;
      pwList = true;
      continue;
    }
    if (/(^|[ :])[0-9]+ flaky$/.test(line)) {
      pw.seen = true;
      pw.flaky += count(line, "flaky")!;
      continue;
    }
    if (/(^|[ :])[0-9]+ passed \([0-9.]+(ms|s|m|h)\)$/.test(line)) {
      pw.seen = true;
      pw.passed += count(line, "passed")!;
      continue;
    }
    if (/^FAIL +[^ ]/.test(line)) {
      const s = line.replace(/^FAIL +/, "").replace(/ \[ .* \]$/, "");
      const i = s.indexOf(" > ");
      const index = add("vitest", i < 0 ? s : `${s.slice(0, i)} › ${s.slice(i + 3)}`, i < 0 ? s : s.slice(0, i));
      if (index !== undefined) pendingVitest.add(index);
      continue;
    }
    if (ERROR_LINE.test(line)) {
      for (const index of pendingVitest) if (!errors[index]) errors[index] = line;
      pendingVitest.clear();
      continue;
    }
    if (/^Tests +[0-9]/.test(line)) {
      vt.seen = true;
      vt.failed += count(line, "failed") ?? 0;
      vt.passed += count(line, "passed") ?? 0;
      continue;
    }
    if (/^[^ ].*\.(test|spec)\.[cm]?[jt]sx?:$/.test(raw)) {
      bunFile = raw.slice(0, -1);
      continue;
    }
    if (/^error: /.test(line) || /^expect\(/.test(line)) {
      if (!bunError) bunError = line;
      continue;
    }
    if (line.startsWith("(fail) ")) {
      const s = line.slice(7).replace(/ \[[0-9.]+m?s\]$/, "");
      if (!bunFile) {
        bare.push(`${s}\0${bunError}`);
        bunError = "";
        continue;
      }
      add("bun", `${bunFile} › ${s}`, bunFile, bunError);
      bunError = "";
      withFile.add(s);
      continue;
    }
    if (/^[0-9]+ pass$/.test(line)) {
      bun.passLines++;
      bun.passed = parseInt(line, 10);
      continue;
    }
    if (/^[0-9]+ fail$/.test(line)) {
      bun.failLines++;
      bun.failed = parseInt(line, 10);
      continue;
    }
    if (/^(FAILED|ERROR) [^ ]+::/.test(line)) {
      let s = line.slice(line.indexOf(" ") + 1);
      const i = s.indexOf(" - ");
      const error = i >= 0 ? s.slice(i + 3).trim() : "";
      if (i >= 0) s = s.slice(0, i);
      add("pytest", s.trim(), s.replace(/::.*/, ""), error);
      continue;
    }
    if (/[0-9]+ (failed|passed|errors?)/.test(line) && / in [0-9.]+s/.test(line)) {
      py.seen = true;
      py.failed += (count(line, "failed") ?? 0) + (count(line, "error") ?? 0);
      py.passed += count(line, "passed") ?? 0;
      continue;
    }
    if (TURBO_FAILED.test(line)) tasks.push(line.replace(/^Failed: +/, ""));
  }
  // A (fail) bun printed before any heading is the same test said again
  // under its file further down; one with no file anywhere is still named.
  for (const entry of new Set(bare)) {
    const [test, error = ""] = entry.split("\0");
    if (!withFile.has(test!)) add("bun", test!, "", error);
  }
  if (!tests.length) for (const t of tasks) add("turbo", t, "");
  if (!tests.length) return { tests, files, errors };
  const bunSeen = bun.passLines === 1 && bun.failLines === 1;
  const counted: Record<Kind, number | undefined> = {
    playwright: pw.seen ? pw.failed : undefined,
    vitest: vt.seen ? vt.failed : undefined,
    bun: bunSeen ? bun.failed : undefined,
    pytest: py.seen ? py.failed : undefined,
    turbo: undefined,
  };
  let failed = 0;
  let known = true;
  for (const kind of new Set(kinds)) {
    const c = counted[kind];
    if (c === undefined) known = false;
    failed += c ?? kinds.filter((k) => k === kind).length;
  }
  if (!known) return { tests, files, errors, failed };
  const total =
    (pw.seen ? pw.failed + pw.flaky + pw.passed : 0) +
    (vt.seen ? vt.failed + vt.passed : 0) +
    (bunSeen ? bun.failed + bun.passed : 0) +
    (py.seen ? py.failed + py.passed : 0);
  return { tests, files, errors, failed, total };
}

/** True when the second run failed a test the first did not. */
export function variedBetween(before: readonly string[], after: readonly string[]): boolean {
  const was = new Set(before);
  return after.some((t) => !was.has(t));
}
