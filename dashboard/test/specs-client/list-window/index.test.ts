import { expect, test } from "bun:test";
import { batchAddress, createBatchLoader } from "../../../src/specs-client/list-window";

test("observer and fallback share a request and stop when exhausted (AC-2, AC-3)", async () => {
  let done!: () => void;
  let calls = 0;
  let href: string | undefined = "/?limit=200";
  const loader = createBatchLoader({
    href: () => href, busy: () => false,
    load: async () => { calls++; await new Promise<void>((resolve) => { done = resolve; }); href = undefined; },
  });
  const first = loader.load();
  const second = loader.load();
  expect(calls).toBe(1);
  done();
  await Promise.all([first, second]);
  await loader.load();
  expect(calls).toBe(1);
});

test("failed loads remain available and disposed observers cannot request (AC-2, AC-3, AC-6)", async () => {
  let calls = 0;
  const loader = createBatchLoader({ href: () => "/?limit=200", busy: () => false, load: async () => { calls++; throw new Error("offline"); } });
  await loader.load();
  await loader.load();
  expect(calls).toBe(2);
  loader.dispose();
  await loader.load();
  expect(calls).toBe(2);
});

test("loading from a stale link keeps the current spec, filters and folds (AC-6, AC-7)", () => {
  const next = batchAddress("/specs?limit=200&grow=1&boundary=old-end&q=old&open=old", "http://board.test/specs/aide/older?limit=100&windowLoaded=102&q=current&open=aide%2Fmember&checks=aide%2Fmember#spec-aide/older");
  expect(next.pathname).toBe("/specs/aide/older");
  expect(next.hash).toBe("#spec-aide/older");
  expect(next.searchParams.get("limit")).toBe("200");
  expect(next.searchParams.get("windowLoaded")).toBe("102");
  expect(next.searchParams.get("grow")).toBe("1");
  expect(next.searchParams.get("q")).toBe("current");
  expect(next.searchParams.get("open")).toBe("aide/member");
  expect(next.searchParams.get("checks")).toBe("aide/member");
});

for (const fails of [false, true]) {
  test(`Show more marks the list as waiting until the request ${fails ? "fails" : "answers"} (AC-3)`, async () => {
    const { Window } = await import("happy-dom");
    const { bindListWindow } = await import("../../../src/specs-client/list-window");
    const { AWAITING } = await import("../../../src/specs-client/state.ts");
    const win = new Window({ url: "http://board.test/specs" });
    win.document.body.innerHTML = '<div id="jobrows"><a href="/specs?limit=200" data-list-more>Show more</a></div>';
    const body = win.document.getElementById("jobrows")!;
    const pending = Promise.withResolvers<Response>();
    const keys = ["document", "location", "history", "fetch", "IntersectionObserver"] as const;
    const previous = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    let requested = 0;
    let cleanup: (() => void) | undefined;
    try {
      Object.assign(globalThis, {
        document: win.document, location: win.location, history: win.history,
        IntersectionObserver: undefined,
        fetch: () => { requested++; return pending.promise; },
      });
      cleanup = bindListWindow(win.document as unknown as Document);
      body.querySelector("a")!.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(requested).toBe(1);
      expect(body.classList.contains(AWAITING)).toBe(true);
      if (fails) pending.reject(new Error("offline"));
      else pending.resolve(new Response("", { status: 503 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(body.classList.contains(AWAITING)).toBe(false);
    } finally {
      pending.resolve(new Response("", { status: 503 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      cleanup?.();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      await win.happyDOM.close();
    }
  });
}
