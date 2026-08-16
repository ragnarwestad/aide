// Criterion 4: normalization of BOTH real manifests (fixtures are
// verbatim copies) into exact expected render values — including
// logging.where arriving as a list (paceup) and a string (atlasaurus).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../src/parse-manifest.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", "manifests", name), "utf-8");

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
