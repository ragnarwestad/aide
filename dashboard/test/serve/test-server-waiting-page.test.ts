// The page the test-server link opens. Two states, and no navigation of
// its own: this tab was opened from the spec page, which is still
// standing in the one behind it.

import { describe, expect, test } from "bun:test";
import { testServerFailedPage, testServerUrlFor, waitingForTestServerPage } from "../../src/serve/routes/spec-edit/test-server-waiting.ts";

const body = (r: Response) => r.text();

describe("waiting for a test server", () => {
  test("names the spec in quotes, on its own line, so it reads apart from the sentence", async () => {
    const html = await body(waitingForTestServerPage("aide", "415-specs-og-new-spec-side-layout"));
    expect(html).toContain('Starting a test server for<br>"415-specs-og-new-spec-side-layout"');
  });

  test("comes back by itself, and says something is coming", async () => {
    const html = await body(waitingForTestServerPage("aide", "415-x"));
    expect(html).toMatch(/http-equiv="refresh"/);
    expect(html).toContain('class="spin"');
    expect(html).toContain("leave it open");
  });

  // The reader clicked a link in the spec page; that page is still open.
  test("offers no way back to the spec", async () => {
    const html = await body(waitingForTestServerPage("aide", "415-x"));
    expect(html).not.toContain("Back to the spec");
    expect(html).not.toContain("<a ");
  });

  // AC-4: a board that is starting is never shown the failed page's own
  // retry link.
  test("never offers to try again — it is already trying", async () => {
    const html = await body(waitingForTestServerPage("aide", "415-x"));
    expect(html).not.toContain("Try again");
  });
});

describe("a test server that could not start", () => {
  test("says so, with the round's own words, and stops refreshing", async () => {
    const html = await body(testServerFailedPage("415-x", "port already held"));
    expect(html).toContain('Could not start a test server for "415-x"');
    expect(html).toContain("port already held");
    expect(html).not.toMatch(/http-equiv="refresh"/);
    // The ELEMENT, not the word: the stylesheet is shared, so its own
    // `.spin` rule is in both pages either way.
    expect(html).not.toContain('class="spin"');
  });

  test("with nothing to quote, it still says what happened", async () => {
    const html = await body(testServerFailedPage("415-x"));
    expect(html).toContain("did not report an address");
  });

  // Arbitrary text off a log reaches this page.
  test("the round's words are escaped", async () => {
    const html = await body(testServerFailedPage("415-x", "<script>alert(1)</script>"));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  // AC-1/AC-2 (spec 489): given a retry link, the page offers it. `esc()`
  // turns the `&` between query parameters into `&amp;`, so this asserts
  // substrings rather than the whole `href` as one exact string.
  test("with a retry link, it offers a way to try again", async () => {
    const html = await body(
      testServerFailedPage(
        "415-x",
        "port already held",
        "/specs/aide/415-x?tab=steps&startTestServer=1&retryTestServer=1",
      ),
    );
    expect(html).toContain("Try again");
    expect(html).toContain('href="');
    expect(html).toContain("retryTestServer=1");
  });

  // AC-4 (backward compatibility): no third argument, no link — every
  // existing caller that omits it renders exactly as before.
  test("with no retry link given, it offers nothing to press", async () => {
    const html = await body(testServerFailedPage("415-x", "port already held"));
    expect(html).not.toContain("Try again");
  });
});

// The round only ever knows loopback: it started the board on this
// machine and says `http://127.0.0.1:<port>/`. Sending a browser there
// sends it to the reader's OWN machine, which has nothing on that port
// — "the dashboard is on the tailnet, and this device cannot reach it".
describe("the board's address, as the reader can reach it", () => {
  const asking = (url: string, host: string) =>
    new Request(url, { headers: { host } });

  test("takes the host the reader used, and keeps the board's port", () => {
    expect(
      testServerUrlFor(
        asking("https://rw-macmini.ts.net/specs/aide/415-x", "rw-macmini.ts.net"),
        "http://127.0.0.1:8801/?token=t0ken",
      ),
    ).toBe("https://rw-macmini.ts.net:8801/?token=t0ken");
  });

  // `tailscale serve` terminates TLS and proxies plain HTTP to loopback:
  // the request arriving here says `http:` while the reader is on
  // `https:`. The pool's ports are TLS listeners too, so a redirect that
  // kept `http:` sent the reader's browser to plain HTTP against a TLS
  // port, and the answer was 400.
  test("takes the scheme from x-forwarded-proto, not from the proxied request", () => {
    const proxied = new Request("http://127.0.0.1:8788/specs/aide/415-x", {
      headers: { host: "rw-macmini.ts.net", "x-forwarded-proto": "https" },
    });
    expect(testServerUrlFor(proxied, "http://127.0.0.1:8801/?token=t0ken")).toBe(
      "https://rw-macmini.ts.net:8801/?token=t0ken",
    );
  });

  test("with no proxy in front, the request's own scheme still decides", () => {
    expect(
      testServerUrlFor(asking("http://box.local:8788/x", "box.local:8788"), "http://127.0.0.1:8801/?token=t"),
    ).toBe("http://box.local:8801/?token=t");
  });

  test("the token rides along untouched", () => {
    const out = testServerUrlFor(
      asking("https://host.ts.net/x", "host.ts.net"),
      "http://127.0.0.1:8802/?token=abc%2Fdef",
    );
    expect(out).toContain("token=abc%2Fdef");
    expect(out).toContain(":8802");
  });

  // A reader sitting at the serving machine still gets there.
  test("a request with no host at all falls back to what the round said", () => {
    const bare = new Request("http://127.0.0.1:8788/x");
    bare.headers.delete("host");
    expect(testServerUrlFor(bare, "http://127.0.0.1:8801/?token=t")).toContain("8801");
  });

  test("an address the round did not phrase as a URL is passed through", () => {
    expect(testServerUrlFor(asking("https://h.ts.net/x", "h.ts.net"), "not a url")).toBe("not a url");
  });
});
