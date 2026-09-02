// Spec 358: a spec's page opens the spec as a PDF.

import { describe, expect, test } from "bun:test";
import type { SpecPageView } from "../../../src/render.ts";
import { page, view } from "./spec-page-fixtures.ts";

const PDF_ACTION = "/specs/aide/150-one-page-shows-the-whole-spec/pdf";

describe("spec 358: the PDF button", () => {
  const withPdf = (extra: Partial<SpecPageView> = {}) => page(view({ pdfAction: PDF_ACTION, ...extra }));

  const actionsGroup = (html: string): string =>
    /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(html)?.[1] ?? "";

  // REQ-1a
  test("an active spec offers the PDF button immediately before Reset", () => {
    const group = actionsGroup(withPdf({ resetAction: "/reset-confirm" }));
    expect(group).toContain(`href="${PDF_ACTION}"`);
    expect(group.indexOf("PDF")).toBeLessThan(group.indexOf("Reset"));
  });

  // REQ-1, REQ-2
  test("it is a plain link carrying an icon, opening in a new tab — not a form", () => {
    const html = withPdf();
    const match = new RegExp(`<a class="btn" href="${PDF_ACTION}"[^>]*>([\\s\\S]*?)</a>`).exec(html);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('target="_blank"');
    expect(match![0]).toContain('rel="noopener"');
    expect(match![0]).toContain("data-pdf");
    expect(match![1]).toContain("<svg");
    expect(html).not.toMatch(new RegExp(`<form[^>]*action="${PDF_ACTION}"`));
  });

  // REQ-1b: Reset renders nothing on an archived spec, so "before Reset"
  // resolves to right after Reopen and before Update there.
  test("an archived spec offers it right after Reopen and before Update", () => {
    const group = actionsGroup(withPdf({ archived: true, token: "t0ken" }));
    expect(group.indexOf("Reopen")).toBeLessThan(group.indexOf("PDF"));
    expect(group.indexOf("PDF")).toBeLessThan(group.indexOf("Update"));
  });

  // REQ-7, REQ-9b: disabled with the reason present, never absent.
  test("when the tool is unavailable the control is disabled with its reason, never absent", () => {
    const html = withPdf({ pdfUnavailableReason: "md-to-pdf is not installed on this host" });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("md-to-pdf is not installed on this host");
    expect(html).not.toContain(`href="${PDF_ACTION}"`);
    expect(html).toContain(" PDF</span>");
  });

  test("no pdfAction at all draws nothing", () => {
    expect(page(view())).not.toContain(" PDF</a>");
    expect(page(view())).not.toContain(" PDF</span>");
  });
});
