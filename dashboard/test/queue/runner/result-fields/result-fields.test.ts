// The result file's structured fields, read from the cases
// core/tests/fixtures/result-fields.json keeps: the runner's own tests check
// that what it writes has the shape of these cases, and this reads each one
// through the parser the dashboard uses for that field.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { providerError, testsNotStarted, testsRed, timeLimit } from "../../../../src/queue/runner/types.ts";
import { scopeAnalyzeChecks } from "../../../../src/messages/jobs/outcomes.ts";
import { sideRun } from "../../../../src/queue/runner/side-run.ts";

type Case = { name: string; written: unknown; read: unknown };
const FIELDS = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../../../core/tests/fixtures/result-fields.json"), "utf-8"),
).fields as Record<string, Case[]>;

const PARSERS: Record<string, (raw: unknown) => unknown> = {
  testsRed,
  testsNotStarted,
  timeLimit,
  providerError,
  scopeAnalyze: scopeAnalyzeChecks,
  review: sideRun,
  verify: sideRun,
};

test("every field in the fixture has a parser here", () => {
  expect(Object.keys(FIELDS).sort()).toEqual(Object.keys(PARSERS).sort());
});

for (const [field, cases] of Object.entries(FIELDS)) {
  describe(field, () => {
    for (const c of cases) {
      test(c.name, () => {
        expect(PARSERS[field]!(c.written)).toEqual(c.read);
      });
    }
  });
}
