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
    expect(result.data.deployment?.url).toBe("https://ragnarwestad.github.io/paceup/");
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

// Spec 95: where a branch can be TRIED, as opposed to where the merged
// site lives. Only a project that builds a preview per branch has one,
// so the key follows every other manifest field: absent means absent.
describe("deployment.preview (spec 95)", () => {
  test("a manifest that declares it parses it", () => {
    const result = parseManifest(
      "name: atlasaurus\ndeployment:\n  host: Cloudflare Pages\n" +
        '  preview: "https://{branch}.atlasaurus.pages.dev"\n',
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.data.deployment?.preview).toBe("https://{branch}.atlasaurus.pages.dev");
    expect(result.data.deployment?.host).toBe("Cloudflare Pages");
  });

  test("a manifest without it leaves it undefined — aide's and PaceUp's do", () => {
    for (const name of ["paceup.yaml", "atlasaurus.yaml"]) {
      const result = parseManifest(fixture(name));
      if (!result.ok) throw new Error(result.error);
      expect(result.data.deployment?.preview).toBeUndefined();
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
describe("schedule (spec 259)", () => {
  test("a valid entry parses, enabled defaulting true", () => {
    const result = parseManifest(
      "name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
    ]);
  });

  test("several entries all parse", () => {
    const result = parseManifest(
      "name: x\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs/weekly.md\n",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toHaveLength(2);
    expect(result.data.schedule?.[1]).toEqual({
      name: "weekly", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true,
    });
  });

  test("a malformed cron drops that entry, not the whole list", () => {
    const result = parseManifest(
      "name: x\nschedule:\n" +
        "  - name: nightly\n    cron: not-a-cron\n    prompt: docs/nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs/weekly.md\n",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toEqual([
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
    ]);
  });

  test("a prompt path that escapes the project root drops that entry (acceptance criterion 8)", () => {
    for (const prompt of ["../../etc/passwd", "/etc/passwd", "a/../../b"]) {
      const result = parseManifest(
        `name: x\nschedule:\n  - name: nightly\n    cron: "0 3 * * *"\n    prompt: ${prompt}\n`,
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.data.schedule).toBeUndefined();
    }
  });

  test("a prompt path with an internal .. that stays inside the root is kept", () => {
    const result = parseManifest(
      "name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/../docs/nightly.md\n",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs/../docs/nightly.md", enabled: true },
    ]);
  });

  test("an entry missing a required field is dropped", () => {
    const result = parseManifest("name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n");
    if (!result.ok) throw new Error(result.error);
    expect(result.data.schedule).toBeUndefined();
  });

  test("a manifest without it leaves it undefined — aide's and PaceUp's do", () => {
    for (const name of ["paceup.yaml", "atlasaurus.yaml"]) {
      const result = parseManifest(fixture(name));
      if (!result.ok) throw new Error(result.error);
      expect(result.data.schedule).toBeUndefined();
    }
  });

  describe("enabled (acceptance criterion 1)", () => {
    test("absent means enabled", () => {
      const result = parseManifest(
        "name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n",
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.data.schedule?.[0].enabled).toBe(true);
    });

    test("enabled: true stays enabled", () => {
      const result = parseManifest(
        "name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n    enabled: true\n",
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.data.schedule?.[0].enabled).toBe(true);
    });

    test("enabled: false is disabled", () => {
      const result = parseManifest(
        "name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n    enabled: false\n",
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.data.schedule?.[0].enabled).toBe(false);
    });

    test("a non-boolean value means enabled — only the literal false disables", () => {
      const result = parseManifest(
        "name: x\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs/nightly.md\n    enabled: \"no\"\n",
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.data.schedule?.[0].enabled).toBe(true);
    });
  });
});
