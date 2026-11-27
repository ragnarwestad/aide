// The specs list offers a test server only for a spec whose code branch origin
// holds. This proves the served list is wired to that rule, once: the
// capability of the project and the cached origin answer together. The rule
// itself is proven where it lives (`branch-on-origin.test.ts`, `row-marks.test.ts`).

import { afterEach, describe, expect, test } from "bun:test";
import { ran } from "../../helpers/queue-server.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/process/index.ts";
import { listUntil, specPanel, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

const FOLDER = "81-queue-and-runner";
const LINK = "startTestServer=1";

describe("the specs list offers a test server only while the spec's branch is on origin", () => {
  /** Real git for the history, a fake origin for the branch question. */
  function originGit(originHasBranch: boolean) {
    const real = createGitRunner();
    const asked: string[] = [];
    const run: GitRunner = async (dir, args, timeoutMs, env) => {
      if (args.join(" ") === "ls-remote --heads origin refs/heads/aide/*") {
        asked.push(dir);
        return {
          code: 0,
          stdout: originHasBranch ? `deadbeef0000000000000000000000000000000\trefs/heads/aide/${FOLDER}\n` : "",
        };
      }
      return real(dir, args, timeoutMs, env);
    };
    return { run, asked };
  }

  test("a capable project whose branch is on origin has the link", async () => {
    const git = originGit(true);
    const { base, dir } = start({ gitRun: git.run, testServersAvailable: true });
    ran(dir, ["create", "analyze", "implement"]);
    const html = await listUntil(
      base,
      (h) => specPanel(h, FOLDER).includes(LINK),
      undefined,
      "the test server link",
    );
    expect(specPanel(html, FOLDER)).toContain(`/specs/aide/${FOLDER}?tab=steps&amp;${LINK}`);
  });
});
