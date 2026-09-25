// What a faulty deploy leaves at the top of every page: one message in
// the board's message layout, in the page's language, before <main>.

import { afterEach, describe, expect, test } from "bun:test";
import { headerNotices } from "../../../../src/render/ui/header-notices.ts";
import { setDeployFaultNotice } from "../../../../src/render/ui/faults/deploy-fault.ts";
import { pageShell } from "../../../../src/render/ui/shell.ts";
import { createServerState, setDeployFault } from "../../../../src/serve/state.ts";

afterEach(() => setDeployFaultNotice(null));

const FAULT = { key: "landing.deployServiceOlder", values: { served: "abc1234", head: "9999999" } } as const;

describe("headerNotices: the deploy fault", () => {
  test("is a failed message with the deploy-fault hook, in the page's language (AC-7)", () => {
    setDeployFaultNotice(FAULT);
    const en = headerNotices("en");
    expect(en).toMatch(/<p class="deploy-fault rowmsg failed">.*abc1234.*9999999/s);
    expect(en).toContain("press Deploy again to restart it");
    expect(headerNotices("nb")).toContain("trykk Deploy på nytt");
  });

  test("draws nothing when none is stored (AC-7)", () => {
    expect(headerNotices("en")).not.toContain("deploy-fault");
  });

  test("sits between the header and <main> on a page (AC-7)", () => {
    setDeployFaultNotice(FAULT);
    const html = pageShell("Projects", [{ label: "Projects", path: "/projects" }], "/projects", "<p>body</p>", "2026-09-14T00:00:00Z");
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("deploy-fault"));
    expect(html.indexOf("deploy-fault")).toBeLessThan(html.indexOf("<main>"));
  });

  test("the server's own writer feeds it, clears it, and a fresh state starts without it (AC-7)", () => {
    const state = createServerState();
    setDeployFault(state, FAULT);
    expect(headerNotices("en")).toContain("deploy-fault");
    setDeployFault(state, null);
    expect(headerNotices("en")).not.toContain("deploy-fault");
    setDeployFault(state, FAULT);
    createServerState();
    expect(headerNotices("en")).not.toContain("deploy-fault");
  });

  test("a replaced server cannot write the shared notice (AC-7)", () => {
    const old = createServerState();
    createServerState();
    setDeployFault(old, FAULT);
    expect(headerNotices("en")).not.toContain("deploy-fault");
  });
});
