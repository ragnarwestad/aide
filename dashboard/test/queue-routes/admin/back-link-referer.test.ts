import { afterEach, describe, expect, test } from "bun:test";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

describe("a page's own Back link, read off the Referer header", () => {
  test("a Referer that is another tab of the same page falls back", async () => {
    const { base } = start();
    const html = await (
      await fetch(`${base}/settings?tab=process`, { headers: { referer: `${base}/settings` } })
    ).text();
    expect(html).toMatch(/<a class="backlink"[^>]*href="\/"/);
  });

  test("a Referer that is another page of the board is where Back goes", async () => {
    const { base } = start();
    const html = await (
      await fetch(`${base}/settings?tab=process`, { headers: { referer: `${base}/specs?project=aide` } })
    ).text();
    expect(html).toMatch(/<a class="backlink"[^>]*href="\/specs\?project=aide"/);
  });
});
