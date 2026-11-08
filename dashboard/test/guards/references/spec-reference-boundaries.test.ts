import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");
const source = (path: string): string => readFileSync(join(root, path), "utf8");

test("board-facing spec names pass through the shared reference rule", () => {
  const cases: Array<[string, RegExp]> = [
    ["dashboard/src/queue/store/index.ts", /on \$\{parsed\.job\.specFolder\}/],
    ["dashboard/src/queue/parse-request.ts", /\$\{r\.specFolder\} is (?:\$\{|already)/],
    ["dashboard/src/render/pages/spec-page/ask-dialog.ts", /(?:Close|Reopen) \$\{specFolder\}/],
    ["dashboard/src/render/pages/jobs-page/rows.ts", /\$\{stepLabel\(step, lang\)\} \$\{row\.specFolder\}/],
  ];
  for (const [path, rawReference] of cases) expect(source(path)).not.toMatch(rawReference);
});

test("runner-facing spec names pass through the shared reference rule (AC-2, AC-3)", () => {
  const cases: Array<[string, RegExp]> = [
    ["core/scripts/lib/run-spec/setup/gates.sh", /\$spec_folder depends on \$dependency_folder/],
    ["core/scripts/lib/run-spec/turn/step-tests.sh", /spec folder \$spec_folder/],
    ["core/scripts/lib/run-spec/record/specs-guard.sh", /only \$spec_folder\//],
    ["core/scripts/lib/run-spec/record/shared-files-check.sh", /\.spec \+ ": "/],
  ];
  for (const [path, rawReference] of cases) expect(source(path)).not.toMatch(rawReference);
});
