// The wiki lives in `wiki/` beside the numbered spec folders. The scan lists
// only `<digits>-…` folders, so the wiki needs no exemption there; this pins
// the folder's name against that rule.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProjectViews } from "../../../src/project/discover";

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "aide-wiki-scan-"));
  const project = join(root, "proj");
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "project.yaml"), "name: proj\n");
  mkdirSync(join(project, "specs", "01-first"), { recursive: true });
  writeFileSync(join(project, "specs", "01-first", "1-description.md"), "# First - Description\n");
  mkdirSync(join(project, "specs", "wiki"), { recursive: true });
  writeFileSync(join(project, "specs", "wiki", "index.md"), "# Wiki index\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a wiki folder beside the spec folders is not listed as a spec (AC-2)", () => {
  const views = buildProjectViews(root);
  expect(views.find((p) => p.name === "proj")!.specs.map((s) => s.folder)).toEqual(["01-first"]);
});
