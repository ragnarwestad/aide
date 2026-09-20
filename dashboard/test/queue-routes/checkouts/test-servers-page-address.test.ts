// The Address link on GET /test-servers is the address the READER can reach:
// the round prints a loopback address, and a phone on the tailnet cannot
// open that.
import { afterEach, describe, expect, test } from "bun:test";
import { MAIN_TEST_SERVER_KEY } from "../../../src/serve/test-servers/lifecycle.ts";
import type { TestServer, TestServerStore } from "../../../src/serve/test-servers/store.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-test-servers-address-");
afterEach(() => harness.cleanup());

const FOLDER = "82-a-spec";

const board = (overrides: Partial<TestServer> = {}): TestServer => ({
  branch: `aide/${FOLDER}`,
  commit: "abc1234deadbeef",
  port: 8801,
  wrapperPid: 1,
  pid: 4242,
  url: "http://127.0.0.1:8801/?token=t0ken",
  workDir: "/tmp/aide-test-servers-address",
  logPath: "/tmp/aide-test-servers-address/board.log",
  status: "running",
  startedAt: "2026-09-20T00:00:00.000Z",
  ...overrides,
});

const pageFor = async (headers: Record<string, string>, allowedHosts: string[], seed: (s: TestServerStore) => void) => {
  const { base, server } = start({ testServersIsAlive: () => true, allowedHosts });
  seed(server.testServersStore());
  return (await fetch(`${base}/test-servers`, { headers })).text();
};

describe("the Address link on /test-servers (AC-4)", () => {
  test("it carries the host and scheme the reader used, and no loopback address (AC-4)", async () => {
    const html = await pageFor(
      { host: "rw-macmini.ts.net", "x-forwarded-proto": "https" },
      ["rw-macmini.ts.net"],
      (s) => s.set("aide", FOLDER, board()),
    );
    expect(html).toContain('href="https://rw-macmini.ts.net:8801/?token=t0ken"');
    expect(html).not.toContain("127.0.0.1");
  });

  test("without a forwarding header the scheme is the request's own (AC-4)", async () => {
    const html = await pageFor({ host: "box.local:8788" }, ["box.local"], (s) => s.set("aide", FOLDER, board()));
    expect(html).toContain('href="http://box.local:8801/?token=t0ken"');
  });

  test("the main board is built the same way, and a starting row has no link (AC-4)", async () => {
    const html = await pageFor(
      { host: "box.local:8788" },
      ["box.local"],
      (s) => {
        s.set("aide", MAIN_TEST_SERVER_KEY, board({ branch: "main", port: 8802, url: "http://127.0.0.1:8802/?token=m4in" }));
        s.set("aide", FOLDER, board({ status: "starting", pid: undefined, url: undefined }));
      },
    );
    expect(html).toContain('href="http://box.local:8802/?token=m4in"');
    expect(html.match(/target="_blank"/g)).toHaveLength(1);
  });
});
