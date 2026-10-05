import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `aide-run-spec` plus every phase it sources, as one text — the same
 *  reading `core/tests/conftest.py`'s `run_spec_source` fixture gives the
 *  Python side. The runner was one 2925-line file until 2026-09-04. */
export function runSpecSource(): string {
  const scripts = new URL("../../../core/scripts", import.meta.url).pathname;
  return [
    readFileSync(join(scripts, "aide-run-spec"), "utf-8"),
    ...runSpecParts().map((f) => readFileSync(f, "utf-8")),
  ].join("\n");
}

/** Every phase file of the runner, under `core/scripts/lib/run-spec/`. Throws
 *  when it finds none, so a moved folder fails a test rather than leaving it
 *  reading nothing. */
export function runSpecParts(): string[] {
  const dir = new URL("../../../core/scripts/lib/run-spec", import.meta.url).pathname;
  const parts = (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".sh"))
    .sort()
    .map((f) => join(dir, f));
  if (parts.length < 20) throw new Error(`only ${parts.length} runner phases under ${dir}`);
  return parts;
}
