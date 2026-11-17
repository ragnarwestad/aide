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
  const next = batchAddress("/specs?limit=200&grow=1&boundary=old-end&q=old&open=old", "http://board.test/specs/aide/older?limit=100&q=current&open=aide%2Fmember&checks=aide%2Fmember#spec-aide/older");
  expect(next.pathname).toBe("/specs/aide/older");
  expect(next.hash).toBe("#spec-aide/older");
  expect(next.searchParams.get("limit")).toBe("200");
  expect(next.searchParams.get("grow")).toBe("1");
  expect(next.searchParams.get("q")).toBe("current");
  expect(next.searchParams.get("open")).toBe("aide/member");
  expect(next.searchParams.get("checks")).toBe("aide/member");
});
