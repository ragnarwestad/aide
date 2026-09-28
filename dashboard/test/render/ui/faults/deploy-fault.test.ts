// What a faulty deploy leaves at the top of every page: one message in
// the board's message layout, in the page's language, before <main>.

import { afterEach, describe, expect, test } from "bun:test";
import { headerNotices } from "../../../../src/render/ui/header-notices.ts";
import { setDeployFaultNotice } from "../../../../src/render/ui/faults/deploy-fault.ts";
import { createServerState, setDeployFault } from "../../../../src/serve/state.ts";

afterEach(() => setDeployFaultNotice(null));

const FAULT = { key: "landing.deployServiceOlder", values: { served: "abc1234", head: "9999999" } } as const;

describe("headerNotices: the deploy fault", () => {
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
