import { describe, expect, test } from "bun:test";
import { renderSpecsPage, type SpecsPageOptions } from "../../../../../src/render";

const page = (opts: Partial<SpecsPageOptions> = {}): string =>
  renderSpecsPage([], "2026-08-30T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
    runnerAvailable: true,
    targets: [],
    ...opts,
  });

describe("sortableHead() (spec 336, REQ-1/REQ-2)", () => {
  test("the Created header carries data-col=\"created\" alongside its colspan, the Spec header none", () => {
    const thead = page().match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(thead).toMatch(/<th class=""[^>]*colspan="2"[^>]*data-col="created"[^>]*>/);
    expect(thead).toMatch(/<th class=""[^>]*data-col="spec"[^>]*>/);
    expect(thead).not.toMatch(/<th[^>]*colspan="2"[^>]*data-col="spec"/);
  });
});
