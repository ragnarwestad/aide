import { readFileSync } from "node:fs";

export interface TestTiming { file: string; name: string; milliseconds: number }

export function slowTests(outputs: readonly string[], limit = 25): TestTiming[] {
  const timings = new Map<string, TestTiming>();
  for (const output of outputs) {
    let file: string | undefined;
    const failures = new Set<string>();
    for (const raw of output.split("\n")) {
      const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
      const heading = line.match(/^(.+\.test\.[cm]?[jt]sx?):$/);
      if (heading) { file = heading[1]; continue; }
      const result = line.match(/^\((?:pass|fail)\) (.+) \[(\d+(?:\.\d+)?)(ms|s)\]$/);
      if (!file || !result) continue;
      if (line.startsWith("(fail)")) {
        if (failures.has(line)) continue;
        failures.add(line);
      }
      const timing = { file, name: result[1]!, milliseconds: Number(result[2]) * (result[3] === "s" ? 1000 : 1) };
      const key = `${file}\0${timing.name}`;
      if (timing.milliseconds > (timings.get(key)?.milliseconds ?? -1)) timings.set(key, timing);
    }
  }
  return [...timings.values()].sort((a, b) => b.milliseconds - a.milliseconds).slice(0, limit);
}

if (import.meta.main) {
  const tests = slowTests(process.argv.slice(2).map((file) => readFileSync(file, "utf8")));
  if (tests.length) console.log("--- slowest test bodies (setup time is not included)");
  for (const test of tests) console.log(`${test.milliseconds.toFixed(2)} ms ${test.file} > ${test.name}`);
}
