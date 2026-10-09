// A manifest written before the description keys were dropped still reads:
// the keys nothing uses are left out of the result, the way `schedule` and
// `criteriaChecks` are.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../src/project/parse-manifest.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "..", "fixtures", "manifests", name), "utf-8");

const RETIRED_TOP_LEVEL = [
  "stack", "dependencies", "logging", "statistics", "reports", "docs", "reuse", "generated", "installCmd",
];

describe("parseManifest ignores the keys nothing reads", () => {
  test("a manifest with every retired key reads the kept ones and drops the rest (AC-1)", () => {
    const result = parseManifest([
      "name: x",
      "generated: 2026-01-01",
      "stack:",
      "  language: TypeScript",
      "dependencies: [a, b]",
      "deployment:",
      "  host: Somewhere",
      "  command: make deploy",
      "  url: https://x.example",
      "  note: be careful",
      "  preview: https://{branch}.x.example",
      "  previewFrom: command",
      "logging:",
      "  where: [Sentry]",
      "statistics: [https://stats.example]",
      "reports:",
      "  - title: Weekly",
      "docs: [docs/README.md]",
      "reuse: [src/lib]",
      "installCmd: make install",
      "AIDE_TEST_CMD: make test",
      "",
    ].join("\n"));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.name).toBe("x");
    expect(result.data.AIDE_TEST_CMD).toBe("make test");
    expect(result.data.deployment).toEqual({ previewFrom: "command" });
    for (const key of RETIRED_TOP_LEVEL) expect(result.data).not.toHaveProperty(key);
  });

  test("the real manifests still read, without the keys they carry (AC-1)", () => {
    for (const [file, name] of [["paceup.yaml", "paceup"], ["atlasaurus.yaml", "atlasaurus"]]) {
      const result = parseManifest(fixture(file));
      if (!result.ok) throw new Error(result.error);
      expect(result.data.name).toBe(name);
      for (const key of RETIRED_TOP_LEVEL) expect(result.data).not.toHaveProperty(key);
      expect(result.data.deployment).toBeUndefined();
    }
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
  });
});

// How one branch of the project can be tried before it is merged. A
// three-word setting, so a word it does not know reads as absent — the
// same as not setting it, which means a branch cannot be tried.
describe("deployment.previewFrom", () => {
  test("each of the three words is kept (AC-4)", () => {
    for (const word of ["cloudflare-pages", "command", "none"] as const) {
      const result = parseManifest(`name: x\ndeployment:\n  previewFrom: ${word}\n`);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.deployment?.previewFrom).toBe(word);
    }
  });

  test("an unknown word, an absent key and the old URL template read as no previewFrom (AC-4)", () => {
    const unknown = parseManifest("name: x\ndeployment:\n  previewFrom: vercel\n");
    const oldTemplate = parseManifest('name: x\ndeployment:\n  preview: "https://{branch}.x.pages.dev"\n');
    for (const result of [unknown, oldTemplate]) {
      if (!result.ok) throw new Error(result.error);
      expect(result.data.deployment).toBeUndefined();
    }
    for (const name of ["paceup.yaml", "atlasaurus.yaml"]) {
      const result = parseManifest(fixture(name));
      if (!result.ok) throw new Error(result.error);
      expect(result.data.deployment?.previewFrom).toBeUndefined();
    }
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
