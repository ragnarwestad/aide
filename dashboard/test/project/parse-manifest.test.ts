// Criterion 4: normalization of BOTH real manifests (fixtures are
// verbatim copies) into exact expected render values — including
// logging.where arriving as a list (paceup) and a string (atlasaurus).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../src/project/parse-manifest.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "..", "fixtures", "manifests", name), "utf-8");

describe("parseManifest on the real manifests", () => {
  test("paceup: exact values", () => {
    const result = parseManifest(fixture("paceup.yaml"));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.name).toBe("paceup");
    expect(result.data.deployment?.url).toBe("https://example.github.io/paceup/");
    expect(result.data.statistics).toEqual(["https://paceup.goatcounter.com"]);
    // list stays a list
    expect(result.data.logging?.where).toHaveLength(3);
  });

  test("atlasaurus: exact values, string logging.where becomes a list", () => {
    const result = parseManifest(fixture("atlasaurus.yaml"));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.name).toBe("atlasaurus");
    expect(result.data.deployment?.url).toBe("https://atlasaurus.online");
    expect(result.data.statistics).toEqual([
      "https://atlasaurus.goatcounter.com",
      "Google Search Console, domain property atlasaurus.online",
      "https://supabase.com/dashboard/project/ybpumverjdhntlsglhyt/editor (feedback + search_misses rows)",
    ]);
    expect(result.data.logging?.where).toEqual([
      "Sentry, org atlasaurus-w7, project atlasaurus (de.sentry.io — EU; prod-only by design)",
    ]);
  });

  test("invalid YAML reports an error instead of throwing", () => {
    const result = parseManifest("name: [broken\n  indentation: {{");
    expect(result.ok).toBe(false);
  });

  test("missing keys stay absent — nothing is invented", () => {
    const result = parseManifest("name: tiny\n");
    if (!result.ok) throw new Error(result.error);
    expect(result.data.name).toBe("tiny");
    expect(result.data.deployment).toBeUndefined();
    expect(result.data.statistics).toBeUndefined();
  });
});

// How one branch of the project can be tried before it is merged. A
// three-word setting, so a word it does not know reads as absent — the
// same as not setting it, which means a branch cannot be tried.
describe("deployment.previewFrom", () => {
  test("each of the three words is kept (AC-4)", () => {
    for (const word of ["cloudflare-pages", "command", "none"] as const) {
      const result = parseManifest(`name: x\ndeployment:\n  host: Cloudflare Pages\n  previewFrom: ${word}\n`);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.deployment?.previewFrom).toBe(word);
      expect(result.data.deployment?.host).toBe("Cloudflare Pages");
    }
  });

  test("an unknown word, an absent key and the old URL template read as no previewFrom (AC-4)", () => {
    const unknown = parseManifest("name: x\ndeployment:\n  previewFrom: vercel\n");
    const oldTemplate = parseManifest('name: x\ndeployment:\n  preview: "https://{branch}.x.pages.dev"\n');
    for (const result of [unknown, oldTemplate]) {
      if (!result.ok) throw new Error(result.error);
      expect(result.data.deployment?.previewFrom).toBeUndefined();
      expect(result.data.deployment).not.toHaveProperty("preview");
    }
    for (const name of ["paceup.yaml", "atlasaurus.yaml"]) {
      const result = parseManifest(fixture(name));
      if (!result.ok) throw new Error(result.error);
      expect(result.data.deployment?.previewFrom).toBeUndefined();
    }
  });

  test("the manifest skill's example names one of the three words (AC-6)", () => {
    const example = readFileSync(
      join(import.meta.dir, "..", "..", "..", "core", "skills", "aide-manifest", "references", "project.yaml"),
      "utf-8",
    );
    const result = parseManifest(example);
    if (!result.ok) throw new Error(result.error);
    const words: (string | undefined)[] = ["cloudflare-pages", "command", "none"];
    expect(words).toContain(result.data.deployment?.previewFrom);
  });
});

// Spec 220: whether a project's archived code merges straight into its
// default branch or waits on a pull request. A team policy about review,
// so it lives in the COMMITTED manifest and nowhere else — and it fails
// toward today's behaviour, the way every other field here does.
describe("codeLanding (spec 220)", () => {
  test("both recognized values parse", () => {
    for (const value of ["merge", "pr"] as const) {
      const result = parseManifest(`name: x\ncodeLanding: ${value}\n`);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.codeLanding).toBe(value);
    }
  });

  test("an unrecognized value is left absent, not carried through", () => {
    // Absent is the shape the resolver reads as `merge`. Carrying
    // `rebase` through would make every reader downstream decide for
    // itself what a word it has never heard means.
    const result = parseManifest("name: x\ncodeLanding: rebase\n");
    if (!result.ok) throw new Error(result.error);
    expect(result.data.codeLanding).toBeUndefined();
  });

  test("a manifest without it leaves it undefined — aide's and PaceUp's do", () => {
    for (const name of ["paceup.yaml", "atlasaurus.yaml"]) {
      const result = parseManifest(fixture(name));
      if (!result.ok) throw new Error(result.error);
      expect(result.data.codeLanding).toBeUndefined();
    }
  });
});

// Spec 259: a project's own recurring jobs. Committed, like codeLanding
// — no .aide/config fallback — and each entry is validated on its own,
// so one malformed entry never takes a whole project's schedule with it.
describe("schedule", () => {
  test("a manifest's schedule: list is not read — jobs live in the queue config (AC-2)", () => {
    const result = parseManifest(
      "name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.data.name).toBe("x");
    expect(result.data).not.toHaveProperty("schedule");
  });
});

describe("criteriaChecks", () => {
  test("a manifest's criteriaChecks key is not read (AC-8)", () => {
    const result = parseManifest("name: x\ncriteriaChecks: stop\n");
    if (!result.ok) throw new Error(result.error);
    expect(result.data).not.toHaveProperty("criteriaChecks");
  });
});
