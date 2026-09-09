// Spec 358: a spec's page opens the spec as a PDF.

import { describe, expect, test } from "bun:test";
import type { SpecPageView } from "../../../src/render.ts";
import { page, view } from "./spec-page-fixtures.ts";

const PDF_ACTION = "/specs/aide/150-one-page-shows-the-whole-spec/pdf";

describe("spec 358: the PDF button", () => {
  const withPdf = (extra: Partial<SpecPageView> = {}) => page(view({ pdfAction: PDF_ACTION, ...extra }));

  // The end of the title line, where the PDF link lives (2026-09-09) —
  // not the actions row beside the tabs, where it used to sit between
  // Reset and Update.
  const titleLineEnd = (html: string): string =>
    /<div class="backhead">[\s\S]*?<span class="headend">([\s\S]*?)<\/span><\/div>/.exec(html)?.[1] ?? "";
  const actionsGroup = (html: string): string =>
    /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(html)?.[1] ?? "";

  const ARIA_LABEL = 'aria-label="open this spec as a PDF in a new tab"';

  test("it sits at the end of the title line, not in the actions row", () => {
    const html = withPdf({ resetAction: "/reset-confirm" });
    expect(titleLineEnd(html)).toContain(`href="${PDF_ACTION}"`);
    expect(actionsGroup(html)).not.toContain(`href="${PDF_ACTION}"`);
  });

  // REQ-1, REQ-2
  test("it is a plain link carrying an icon, opening in a new tab — not a form", () => {
    const html = withPdf();
    const match = new RegExp(`<a class="iconlink" href="${PDF_ACTION}"[^>]*>([\\s\\S]*?)</a>`).exec(html);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('target="_blank"');
    expect(match![0]).toContain('rel="noopener"');
    expect(match![0]).toContain("data-pdf");
    expect(match![1]).toContain("<svg");
    expect(html).not.toMatch(new RegExp(`<form[^>]*action="${PDF_ACTION}"`));
  });

  // REQ-6 (spec 391): an icon alone — the word "PDF" is dropped — with
  // an aria-label saying what it does, for a reader who cannot see it.
  test("carries no visible 'PDF' text, only the icon and an aria-label naming what it does", () => {
    const html = withPdf();
    const match = new RegExp(`<a class="iconlink" href="${PDF_ACTION}"[^>]*>([\\s\\S]*?)</a>`).exec(html);
    expect(match).not.toBeNull();
    expect(match![0]).toContain(ARIA_LABEL);
    expect(match![1]!.trim()).not.toContain("PDF");
    expect(match![1]).toContain("<svg");
  });

  test("an archived spec has it on the title line too", () => {
    const html = withPdf({ archived: true, token: "t0ken" });
    expect(titleLineEnd(html)).toContain(`href="${PDF_ACTION}"`);
  });

  // REQ-7, REQ-9b: disabled with the reason present, never absent.
  // REQ-6: the same aria-label as the enabled branch, on both the
  // "why" (title) and "what it does" (aria-label) axes.
  test("when the tool is unavailable the control is disabled with its reason, never absent", () => {
    const html = withPdf({ pdfUnavailableReason: "md-to-pdf is not installed on this host" });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("md-to-pdf is not installed on this host");
    expect(html).not.toContain(`href="${PDF_ACTION}"`);
    expect(html).toContain(ARIA_LABEL);
    const span = html.match(/<span class="iconlink" aria-disabled="true"[\s\S]*?<\/span>/)?.[0] ?? "";
    expect(span).not.toContain("PDF<");
  });

  test("no pdfAction at all draws nothing", () => {
    expect(page(view())).not.toContain(ARIA_LABEL);
  });
});
