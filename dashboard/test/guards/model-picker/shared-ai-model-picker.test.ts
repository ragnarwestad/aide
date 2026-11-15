import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");

test("all picker pages use the shared select renderers (AC-4, AC-11)", () => {
  for (const file of [
    "src/render/pages/specs-list/model-picker/index.ts",
    "src/render/pages/settings-page/index.ts",
    "src/render/pages/schedule-page/form.ts",
  ]) {
    expect(readFileSync(join(root, file), "utf8")).toContain("providerSelect");
    expect(readFileSync(join(root, file), "utf8")).toContain("modelSelect");
  }
  const options = readFileSync(join(root, "src/render/pages/new-spec-page/options-tab.ts"), "utf8");
  expect(options).not.toContain("newSpecPhaseTable");
  expect(options).not.toContain("phaseChoiceTable");
});
