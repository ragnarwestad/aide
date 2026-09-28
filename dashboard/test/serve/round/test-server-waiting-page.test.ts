// The page the test-server link opens. Two states, and no navigation of
// its own: this tab was opened from the spec page, which is still
// standing in the one behind it.

import { describe, expect, test } from "bun:test";
import { testServerFailedPage, testServerUrlFor } from "../../../src/serve/routes/spec-edit/test-server-waiting.ts";

const body = (r: Response) => r.text();

describe("a test server that could not start", () => {

  // Arbitrary text off a log reaches this page.
  test("the round's words are escaped", async () => {
    const html = await body(testServerFailedPage("415-x", "<script>alert(1)</script>"));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
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
