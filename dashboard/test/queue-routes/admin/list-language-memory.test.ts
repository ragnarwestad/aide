import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

// Spec 350, REQ-3/REQ-4/REQ-5: the language, remembered the same way
// as the sort column and the state filter.
describe("the language the reader chose is remembered", () => {
  const langCookie = (res: Response): string =>
    res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=")) ?? "";

  test("?lang=nb sets the cookie and renders Norwegian, on that same response", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}&lang=nb`);
    expect(langCookie(res)).toContain("aide_lang=nb");
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
    expect(html).toContain(">Ny<");
  });

  test("a later GET / with the cookie and no ?lang= is Norwegian too", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const chosen = await fetch(`${base}/?token=${TOKEN}&lang=nb`);
    const jar = langCookie(chosen).split(";")[0]!;
    const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
    expect(await plain.text()).toContain('<html lang="nb">');
  });

  test("no cookie and no ?lang= renders English", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}`);
    expect(await res.text()).toContain('<html lang="en">');
    expect(langCookie(res)).toBe("");
  });

  test("the rows-only fetch writes the cookie too", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}&lang=nb&rows=1`);
    expect(langCookie(res)).toContain("aide_lang=nb");
  });
});
