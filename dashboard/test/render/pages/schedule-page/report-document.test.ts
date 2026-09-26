// Spec 495, criteria 7 and 11 (the document half): a report's HTML becomes
// the framed document — the board's tokens in, the report's own styling and
// script out.
import { describe, expect, test } from "bun:test";
import { buildReportDocument } from "../../../../src/render";

const BASE = "/schedule-output/aide/schedule-nightly/runs/j1/";

const DIRTY =
  `<html><head><style>body{color:red}</style><link rel="stylesheet" href="x.css"><meta http-equiv="refresh" content="0">` +
  `<base href="http://evil/"><script>alert(1)</script></head>` +
  `<body bgcolor="#000" style="color:lime" onload="steal()"><font color="red" face="Comic">Findings</font>` +
  `<form action="/x"><p onclick="x()">Inside form</p></form>` +
  `<a href="javascript:alert(1)">bad</a> <a href="https://example.com/a">good</a> <a href="notes.html">rel</a>` +
  `<img src="x" onerror="alert(2)"><iframe src="/y"></iframe><object data="z"></object><embed src="z"></body></html>`;

describe("buildReportDocument", () => {
  test("keeps the report's text and drops its styling, scripts and event attributes", async () => {
    const doc = await buildReportDocument(DIRTY, BASE);
    expect(doc).toContain("Findings");
    expect(doc).toContain("Inside form");
    expect(doc).not.toContain("color:red");
    expect(doc).not.toContain("alert(1)");
    for (const gone of ["<font", "bgcolor", "style=\"color", "onload", "onclick", "onerror", "<form", "<iframe", "<object", "<embed", "evil", "x.css", "http-equiv"]) {
      expect(doc).not.toContain(gone);
    }
  });

  test("drops javascript: links, keeps http(s) and relative ones, and opens every link in a new tab", async () => {
    const doc = await buildReportDocument(DIRTY, BASE);
    expect(doc).not.toContain("javascript:");
    expect(doc).toContain('href="https://example.com/a"');
    expect(doc).toContain('href="notes.html"');
    const anchors = doc.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors.length).toBe(3);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
  });

  test("its base names the run's directory, so a relative link resolves next to the report", async () => {
    const doc = await buildReportDocument("<p>x</p>", BASE);
    expect(doc).toContain(`<base href="${BASE}" target="_blank">`);
  });

  test("carries the board's tokens: the light block, the dark preference and both chosen themes", async () => {
    const doc = await buildReportDocument("<p>x</p>", BASE);
    expect(doc).toContain("--bg: #EFECE5");
    expect(doc).toContain("@media (prefers-color-scheme: dark)");
    expect(doc).toContain(':root[data-theme="dark"]');
    expect(doc).toContain(':root[data-theme="light"]');
    expect(doc).toContain("var(--text)");
  });
});
