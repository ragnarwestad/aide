// The header's Deploy mark: every page renders through pageShell(), so the
// mark that says the board has something to deploy is drawn there, from
// what the drift poll last found.
import { afterEach, describe, expect, test } from "bun:test";

import { t } from "../../../src/i18n";
import { pageShell } from "../../../src/render/ui/shell.ts";
import { deployAskDialog } from "../../../src/render/pages/projects-page/deploy-dialog.ts";
import {
  DEPLOY_MARK_DIALOG, deployMark, deployMarkAnswer, deployMarkDialog, deployMarkStatus, setDeployWaiting,
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
    expect(mark).toContain(t("en", "shell.deployHelpPending"));
    expect(html).toContain(deployAskDialog("en", "aide", DEPLOY_MARK_DIALOG));
  });

  test("answers with the mark followed by its shared question (AC-1)", () => {
    setDeployWaiting(() => ({ project: "aide", commits: 2, branch: "main" }));
    expect(deployMarkAnswer("en")).toBe(
      deployMark("en", { project: "aide", commits: 2, branch: "main" })
      + deployAskDialog("en", "aide", DEPLOY_MARK_DIALOG),
    );
  });
});

describe("deployMarkStatus", () => {
  const waiting = (commits: number, underWay?: "queued" | "running") => ({ project: "aide", commits, branch: "main", underWay });

  test("nothing to deploy and nothing under way is current, with no count", () => {
    expect(deployMarkStatus(waiting(0)))
      .toEqual({ status: "current", label: "shell.deployUpToDate", help: "shell.deployHelpCurrent", showsCount: false });
  });

  test("commits waiting are pending, with their count, and one commit takes the singular", () => {
    expect(deployMarkStatus(waiting(3)))
      .toEqual({ status: "pending", label: "shell.deployWaiting", help: "shell.deployHelpPending", showsCount: true });
    expect(deployMarkStatus(waiting(1)).label).toBe("shell.deployWaitingOne");
  });

  test("a queued or running Deploy names its job state and keeps the count while there is one", () => {
    expect(deployMarkStatus(waiting(2, "queued")))
      .toEqual({ status: "queued", label: "project.deployUnderWay", help: "shell.deployHelpQueued", showsCount: true });
    expect(deployMarkStatus(waiting(2, "running")))
      .toEqual({ status: "running", label: "project.deployUnderWay", help: "shell.deployHelpRunning", showsCount: true });
    expect(deployMarkStatus(waiting(0, "running"))).toMatchObject({ status: "running", showsCount: false });
  });

  test("only commits waiting with nothing under way carry the Deploy question", () => {
    expect(deployMarkDialog("en", waiting(2))).not.toBe("");
    expect(deployMarkDialog("en", waiting(0))).toBe("");
    expect(deployMarkDialog("en", waiting(2, "queued"))).toBe("");
    expect(deployMarkDialog("en", waiting(2, "running"))).toBe("");
  });
});
