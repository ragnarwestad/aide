import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTION_FORM_SELECTOR,
  FORM_ACTION_PREFIXES,
  PAGE_DRAWN,
  PAGE_FETCHING,
  PAGE_LEAVE,
  REFUSAL_ROW_TEMPLATE_ID,
  SERVED_BY_META,
  SPEC_DETAIL_DRAWN,
  SPEC_HEAD_CLASS,
  SPEC_LOADING_ROW_ID,
  SPINNER,
  TRACKED_FORM_SELECTOR,
} from "../src/page-contract.ts";

const contractFile = join(import.meta.dir, "..", "src", "page-contract.ts");

describe("the page contract", () => {
  test("is import-free and owns the page names (AC-1, AC-4, AC-5)", () => {
    expect(readFileSync(contractFile, "utf-8")).not.toMatch(/^\s*import\s/m);
    expect({
      ACTION_FORM_SELECTOR,
      PAGE_DRAWN,
      PAGE_FETCHING,
      PAGE_LEAVE,
      REFUSAL_ROW_TEMPLATE_ID,
      SERVED_BY_META,
      SPEC_DETAIL_DRAWN,
      SPEC_HEAD_CLASS,
      SPEC_LOADING_ROW_ID,
      SPINNER,
      TRACKED_FORM_SELECTOR,
    }).toEqual({
      ACTION_FORM_SELECTOR: "form.rowrun, form.actionform",
      PAGE_DRAWN: "aide-page-drawn",
      PAGE_FETCHING: "aide-page-fetching",
      PAGE_LEAVE: "aide-page-leave",
      REFUSAL_ROW_TEMPLATE_ID: "refusal-row",
      SERVED_BY_META: "aide-served-by",
      SPEC_DETAIL_DRAWN: "spec-detail-drawn",
      SPEC_HEAD_CLASS: "spechead",
      SPEC_LOADING_ROW_ID: "spec-loading-row",
      SPINNER: '<span class="spin" aria-hidden="true"></span>',
      TRACKED_FORM_SELECTOR: ".specform, .settingsform, .providerform, .pageform, .scheduleform",
    });
    expect(FORM_ACTION_PREFIXES).toEqual([
      "specform", "settingsform", "providerform", "projectsettingsform", "scheduleform",
    ]);
  });

  test("bundles both browser entry points with shared imports (AC-3, AC-5)", async () => {
    for (const entrypoint of ["specs-client/index.ts", "render/scripts/index.ts"]) {
      const built = await Bun.build({
        entrypoints: [join(import.meta.dir, "..", "src", entrypoint)],
        target: "browser",
        format: "iife",
      });
      expect(built.success, entrypoint).toBe(true);
    }
  });
});
