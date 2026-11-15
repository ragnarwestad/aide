// The header's Deploy mark: every page renders through pageShell(), so the
// mark that says the board has something to deploy is drawn there, from
// what the drift poll last found.
import { afterEach, describe, expect, test } from "bun:test";

import { pageShell } from "../../../src/render/ui/shell.ts";
import { setDeployWaiting } from "../../../src/render/ui/deploy-mark/index.ts";

const render = (): string => pageShell("Jobs", [{ label: "Projects", path: "/projects" }], "/", "<p>body</p>", "2026-11-15T00:00:00Z");
const markOf = (html: string): string => html.match(/<(a|span) class="deploymark".*?<\/\1>/s)?.[0] ?? "";

afterEach(() => setDeployWaiting(undefined));

describe("the header's Deploy mark", () => {
  test("links the icon and the commit count to the waiting project's Deploy tab", () => {
    setDeployWaiting(() => ({ project: "aide", commits: 3 }));
    const mark = markOf(render());
    expect(mark).toContain('href="/projects/aide?tab=deploy"');
    expect(mark).toContain("(3)");
  });

  test("links nowhere when nothing is waiting to be deployed", () => {
    setDeployWaiting(() => undefined);
    expect(markOf(render())).not.toContain("href=");
  });
});
