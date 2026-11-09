// `AGENTS.md` tells every session which page answers which question.
// A page with no row is a page a session never opens; a row naming a page
// that is gone sends it to a file that is not there.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..", "..", "..");

function tableRows(): string[] {
  const text = readFileSync(join(REPO, "AGENTS.md"), "utf-8");
  const start = text.indexOf("## Reading the documentation");
  if (start < 0) throw new Error("no 'Reading the documentation' section");
  const rest = text.slice(start + 1);
  const end = rest.search(/\n(---|## )/);
  return (end < 0 ? rest : rest.slice(0, end)).split("\n").filter((l) => l.startsWith("|"));
}

function pagesIn(folder: string): string[] {
  return readdirSync(join(REPO, folder))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${folder}/${f}`);
}

test("the table names every page in dashboard/docs/ and docs/, and no other (AC-8)", () => {
  const named = tableRows()
    .flatMap((row) => [...row.matchAll(/`((?:dashboard\/docs|docs)\/[^`/]+\.md)`/g)].map((m) => m[1]!))
    .sort();
  const onDisk = [...pagesIn("dashboard/docs"), ...pagesIn("docs")].sort();
  expect(named).toEqual(onDisk);
});
