// A spec's own › redraws that spec alone: the server draws its rows and
// nothing else, so opening one row does not cost the whole list.

import { describe, expect, test } from "bun:test";
import { renderSpecGroupRows, type SpecTarget } from "../../../src/render";

const target = (specFolder: string): SpecTarget => ({ project: "aide", specFolder });
const heads = (html: string): string[] =>
  [...html.matchAll(/<tr class="spechead"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]!);

describe("one spec's rows", () => {
  const targets = [target("01-one"), target("02-two"), target("03-three")];

  test("are that spec's alone, opened as the address says", () => {
    const html = renderSpecGroupRows([], { runnerAvailable: true, targets, filter: { open: "aide/02-two" } }, "aide/02-two");
    expect(heads(html)).toEqual(["02-two"]);
    expect(html).toContain('aria-expanded="true"');
  });

  test("are none when the filter does not show that spec", () => {
    const html = renderSpecGroupRows([], { runnerAvailable: true, targets, filter: { q: "three" } }, "aide/02-two");
    expect(heads(html)).toEqual([]);
  });
});
