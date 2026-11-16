// The header's Deploy mark: every page renders through pageShell(), so the
// mark that says the board has something to deploy is drawn there, from
// what the drift poll last found.
import { afterEach, describe, expect, test } from "bun:test";

import { pageShell } from "../../../src/render/ui/shell.ts";
import { deployAskDialog } from "../../../src/render/pages/projects-page/deploy-dialog.ts";
import {
  DEPLOY_MARK_DIALOG, deployMark, deployMarkAnswer, setDeployWaiting,
} from "../../../src/render/ui/deploy-mark/index.ts";

const render = (): string => pageShell("Jobs", [{ label: "Projects", path: "/projects" }], "/", "<p>body</p>", "2026-11-15T00:00:00Z");
const markOf = (html: string): string => html.match(/<(button|span) class="deploymark[^>]*>.*?<\/\1>/s)?.[0] ?? "";

afterEach(() => setDeployWaiting(undefined));

describe("the header's Deploy mark", () => {
  test("draws a waiting button and the same question as the Deploy tab (AC-1, AC-3)", () => {
    setDeployWaiting(() => ({ project: "aide", commits: 3, branch: "main" }));
    const html = render();
    const mark = markOf(html);
    expect(mark).toContain(`data-ask="${DEPLOY_MARK_DIALOG}"`);
    expect(mark).toContain("(3)");
    expect(mark).toContain("aide has 3 new commits to deploy");
    expect(html).toContain(deployAskDialog("en", "aide", DEPLOY_MARK_DIALOG));
  });

  test("draws an empty slot and no question before the first answer (AC-5)", () => {
    setDeployWaiting(() => undefined);
    const html = render();
    expect(markOf(html)).toBe('<span class="deploymark" aria-hidden="true"></span>');
    expect(html).not.toContain(`id="${DEPLOY_MARK_DIALOG}"`);
  });

  test("names one commit in the singular", () => {
    expect(deployMark("en", { project: "aide", commits: 1, branch: "main" })).toContain("aide has 1 new commit to deploy");
  });

  test("draws an up-to-date tick without a count or question (AC-4)", () => {
    setDeployWaiting(() => ({ project: "aide", commits: 0, branch: "main" }));
    const html = render();
    const mark = markOf(html);
    expect(mark).toContain("uptodate");
    expect(mark).toContain("aide is up to date with main");
    expect(mark).not.toContain("data-ask");
    expect(mark).not.toContain("(0)");
    expect(html).not.toContain(`id="${DEPLOY_MARK_DIALOG}"`);
  });

  test("answers with the mark followed by its shared question (AC-1)", () => {
    setDeployWaiting(() => ({ project: "aide", commits: 2, branch: "main" }));
    expect(deployMarkAnswer("en")).toBe(
      deployMark("en", { project: "aide", commits: 2, branch: "main" })
      + deployAskDialog("en", "aide", DEPLOY_MARK_DIALOG),
    );
  });
});
