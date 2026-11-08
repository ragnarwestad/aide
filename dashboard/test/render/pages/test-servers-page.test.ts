import { expect, test } from "bun:test";
import { renderTestServersPage } from "../../../src/render/pages/test-servers-page.ts";

test("offers cleanup with and without registered servers (AC-2)", () => {
  const empty = renderTestServersPage([], "now", []);
  const populated = renderTestServersPage([], "now", [{ project: "aide", specFolder: "1-x", specHref: "/x", branch: "a", status: "running", stopAction: "/stop" }]);
  expect(empty).toContain('action="/api/queue/cleanup"');
  expect(populated).toContain('action="/api/queue/cleanup"');
});
