import { expect, test } from "bun:test";
import { specReference } from "../../src/project/spec-folder.ts";

test.each([
  ["skjera", "62-a-dependency", "skjera:62"],
  ["skjera", "62", "skjera:62"],
  ["aide", "62-a-dependency", "aide:62"],
  ["skjera", "09-a-dependency", "skjera:09"],
  ["skjera", "named-dependency", "skjera:named-dependency"],
])("dependency reference for %s/%s", (project, folder, expected) => {
  expect(specReference(project, folder)).toBe(expected);
});
