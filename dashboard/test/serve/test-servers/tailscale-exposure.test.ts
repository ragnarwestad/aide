// Spec 491: `parseExposedPorts()` is the pure half of the exposure
// check — tested against literal JSON strings, never a spawned
// `tailscale` binary (2-analysis.md's own "Test coverage": no test
// anywhere in this suite spawns a real `tailscale`).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_SERVER_PORTS } from "../../../src/serve/test-servers/lifecycle.ts";
import { exposureOf, parseExposedPorts } from "../../../src/serve/test-servers/tailscale-exposure.ts";

describe("parseExposedPorts", () => {
  // A documented-shape sample (Tailscale's own publicly documented
  // `serve status --json` shape: a `TCP` map keyed by port) — not a
  // captured one (3-solution.md, Risk analysis #1: no `tailscale`
  // binary in this session's environment). Manual verification against
  // a real host reconciles this later, without blocking RED or GREEN.
  test("a documented-shape sample with two exposed ports", () => {
    const json = JSON.stringify({ TCP: { "443": { HTTPS: true }, "8801": { HTTPS: true } } });
    expect(parseExposedPorts(json)).toEqual(new Set([443, 8801]));
  });

  test("an empty TCP map is Tailscale present, nothing exposed — a defined, empty Set", () => {
    expect(parseExposedPorts(JSON.stringify({ TCP: {} }))).toEqual(new Set());
  });

  test("malformed JSON is undefined — cannot tell, never 'nothing exposed'", () => {
    expect(parseExposedPorts("not json")).toBeUndefined();
  });

  test("a shape with no TCP key at all is undefined", () => {
    expect(parseExposedPorts(JSON.stringify({ Foo: "bar" }))).toBeUndefined();
  });
});

// HTTPS through Tailscale is an add-on a user sets up by hand, so a host
// can have Tailscale without putting the test boards behind it.
describe("exposureOf", () => {
  const pool = [8801, 8802];

  test("a host exposing some of the pool is refused the port it left out", () => {
    expect(exposureOf(8802, new Set([443, 8801]), pool)).toBe(false);
    expect(exposureOf(8801, new Set([443, 8801]), pool)).toBe(true);
  });

  test("a host exposing none of the pool has not put the boards behind Tailscale", () => {
    expect(exposureOf(8801, new Set([443]), pool)).toBeUndefined();
    expect(exposureOf(8801, new Set(), pool)).toBeUndefined();
  });

  test("no answer from Tailscale stays cannot-tell", () => {
    expect(exposureOf(8801, undefined, pool)).toBeUndefined();
  });
});

// The commands docs/tailscale.md has the user run by hand name the pool
// port by port; a pool that grows without them leaves a port unreachable.
test("the documented tailscale serve loop names every test-server port", () => {
  const doc = readFileSync(join(import.meta.dir, "..", "..", "..", "docs", "tailscale.md"), "utf-8");
  expect(doc).toContain(`for p in ${TEST_SERVER_PORTS.join(" ")}; do tailscale serve`);
});
