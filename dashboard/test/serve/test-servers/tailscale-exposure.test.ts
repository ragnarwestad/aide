// Spec 491: `parseExposedPorts()` is the pure half of the exposure
// check — tested against literal JSON strings, never a spawned
// `tailscale` binary (2-analysis.md's own "Test coverage": no test
// anywhere in this suite spawns a real `tailscale`).
import { describe, expect, test } from "bun:test";
import { parseExposedPorts } from "../../../src/serve/test-servers/tailscale-exposure.ts";

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
