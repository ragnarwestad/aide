// Spec 482: the Schedule nav tab was baked in at server start
// (`navEntries()`), before any request — and therefore any reader's
// language — existed, so it read "Schedule" on every page whatever the
// language cookie said. `NavEntry.labelKey` moves the choice to
// per-request render time instead.
import { describe, expect, test } from "bun:test";
import { pageShell } from "../../../src/render/ui/shell.ts";
import { navEntries } from "../../../src/render/pages/projects-page/routes.ts";

describe("the Schedule nav tab, in the reader's own language", () => {
  test("reads Kjøring in Norwegian, not Schedule", () => {
    const html = pageShell("Jobs", navEntries(), "/schedule", "<p>body</p>", "2026-09-17T00:00:00Z", undefined, {
      lang: "nb",
    });
    expect(html).toContain(">Kjøring<");
    expect(html).not.toContain(">Schedule<");
  });

  test("English is unchanged", () => {
    const html = pageShell("Jobs", navEntries(), "/schedule", "<p>body</p>", "2026-09-17T00:00:00Z", undefined, {
      lang: "en",
    });
    expect(html).toContain(">Schedule<");
  });

  // A `NavEntry` with no `labelKey` (an absolute-path section this spec
  // does not name, or the generated-site fallback nav's project entries)
  // keeps rendering its `label` exactly as before — the field is a
  // widening, not a narrowing, of the type.
  test("an entry with no labelKey renders its label unchanged", () => {
    const html = pageShell(
      "Jobs",
      [{ label: "Projects", path: "/projects" }, { label: "Other", path: "/other" }],
      "/projects",
      "<p>body</p>",
      "2026-09-17T00:00:00Z",
      undefined,
      { lang: "nb" },
    );
    expect(html).toContain(">Other<");
  });
});

// Spec 484, AC-5: the same English-leak guard, for the three languages
// added beside English and Norwegian.
describe.each(["es", "de", "fr"] as const)("the Schedule nav tab, in %s (spec 484)", (lang) => {
  test("is not the English word", () => {
    const html = pageShell("Jobs", navEntries(), "/schedule", "<p>body</p>", "2026-09-17T00:00:00Z", undefined, {
      lang,
    });
    expect(html).not.toContain(">Schedule<");
  });
});
