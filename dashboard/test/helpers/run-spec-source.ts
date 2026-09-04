import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `aide-run-spec` plus every phase it sources, as one text — the same
 *  reading `tests/conftest.py`'s `run_spec_source` fixture gives the
 *  Python side. The runner was one 2925-line file until 2026-09-04. */
export function runSpecSource(): string {
  const scripts = new URL("../../../core/scripts/", import.meta.url).pathname;
  const parts = readdirSync(join(scripts, "lib")).filter((f) => f.startsWith("run-spec-") && f.endsWith(".sh"));
  return [
    readFileSync(join(scripts, "aide-run-spec"), "utf-8"),
    ...parts.map((f) => readFileSync(join(scripts, "lib", f), "utf-8")),
  ].join("\n");
}
