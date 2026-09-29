// The specs list offers a test server only for a spec whose code branch origin
// holds. This proves the served list is wired to that rule, once: the
// capability of the project and the cached origin answer together. The rule
// itself is proven where it lives (`branch-on-origin.test.ts`, `row-marks.test.ts`).

import { afterEach, describe, expect, test } from "bun:test";
import { ran } from "../../helpers/queue-server.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { specControls, phaseDone, listUntil, specPanel, setupQueueRoutesHarness, OPEN_81 } from "../fixtures.ts";

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

  /** The list once implement shows done and origin has been asked. */
  async function listAfterOriginAnswered(
    opts: { originHasBranch: boolean; testServersAvailable: boolean },
  ): Promise<string> {
    const git = originGit(opts.originHasBranch);
    const { base, dir } = start({ gitRun: git.run, testServersAvailable: opts.testServersAvailable });
    ran(dir, ["create", "analyze", "implement"]);
    await listUntil(
      base,
      (h) => phaseDone(specControls(h, FOLDER), "implement") && git.asked.length > 0,
      undefined,
      "implement done and origin asked",
    );
    // The answer is cached a moment after the ask returns.
    await new Promise((r) => setTimeout(r, 150));
    return await (await fetch(`${base}/?${OPEN_81}`)).text();
  }

  test("a capable project whose branch is on origin has the link (AC-2)", async () => {
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

  test("a branch origin does not hold has no link (AC-1)", async () => {
    const html = await listAfterOriginAnswered({ originHasBranch: false, testServersAvailable: true });
    expect(specPanel(html, FOLDER)).not.toContain(LINK);
  });

  test("a project that cannot run a test server has no link, whatever origin holds (AC-2)", async () => {
    const html = await listAfterOriginAnswered({ originHasBranch: true, testServersAvailable: false });
    expect(specPanel(html, FOLDER)).not.toContain(LINK);
  });
});
