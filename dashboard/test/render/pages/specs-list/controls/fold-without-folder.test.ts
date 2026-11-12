// A spec being created has no folder, so it has no page: its arrow on the
// Specs list leads nowhere until the folder lands.
import { describe, expect, test } from "bun:test";
import { groupBySpec } from "../../../../../src/render/pages/specs-list/data-model";
import { foldControl } from "../../../../../src/render/pages/specs-list/row-controls.ts";
import { row } from "../../fixtures.ts";

const targets = [{ project: "aide", specFolder: "81-a-known-spec" }];
const groupOf = (specFolder: string, over: Record<string, unknown> = {}) =>
  groupBySpec([row({ specFolder, steps: ["create"], stepIndex: 0, state: "running", ...over })], targets)
    .find((g) => g.specFolder === specFolder)!;
const arrow = (specFolder: string, over?: Record<string, unknown>): string =>
  foldControl(groupOf(specFolder, over), {}, new Set(), "en", "/specs", true);

describe("the Specs list's arrow", () => {
  test("offers no address for a spec whose folder has not landed", () => {
    const html = arrow("new-abc123de", { createTitle: "Layout" });
    expect(html).not.toContain("href=");
    expect(html).toContain('aria-disabled="true"');
  });

  test("opens the spec's page once the folder is there", () => {
    expect(arrow("81-a-known-spec")).toContain('href="/specs/aide/81-a-known-spec');
  });
});
