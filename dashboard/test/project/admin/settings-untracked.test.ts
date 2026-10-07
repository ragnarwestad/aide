// Spec 512: a Settings save commits and pushes only where the project's
// manifest is tracked. Elsewhere it goes to the dashboard's own settings
// file, and nothing reaches the project's repository.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { dashboardSettingsFile } from "../../../src/git/dashboard-checkout.ts";
import { parseManifest } from "../../../src/project/parse-manifest.ts";
import { commitManifestEdits, updateProjectSettings } from "../../../src/project/project-admin";
import { git, projectWithOrigin } from "./git-fixture.ts";

const run = createGitRunner(30_000);
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const fixture = (files: Record<string, string> = {}) => {
  const f = projectWithOrigin(files);
  cleanups.push(f.cleanup);
  mkdirSync(join(f.base, "demo"), { recursive: true });
  return f;
};
const seam = { run, resolveBase: async () => "main" };
const saveManifest = (dir: string) => (edits: { key: string; value: string }[]) => commitManifestEdits(seam, dir, edits);

describe("Settings save by whether the manifest is tracked", () => {
  test("no tracked manifest: the settings file holds it, origin and the checkout are untouched (AC-2)", async () => {
    const f = fixture();
    const head = git(f.dir, "rev-parse", "HEAD");
    const originHead = git(f.origin, "rev-parse", "main");
    const result = await updateProjectSettings(run, f.dir, { previewCmd: "make check" }, {
      saveManifest: saveManifest(f.dir),
      settingsFile: dashboardSettingsFile(f.base, "demo"),
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(dashboardSettingsFile(f.base, "demo"), "utf-8")).toContain("previewCmd: make check");
    expect(git(f.origin, "rev-parse", "main")).toBe(originHead);
    expect(git(f.dir, "rev-parse", "HEAD")).toBe(head);
    expect(git(f.dir, "status", "--porcelain")).not.toContain("project.yaml");
  });

  test("git cannot say: the previewCmd step fails with git's words and the install command still saves (AC-2)", async () => {
    const f = fixture();
    const broken: GitRunner = async (dir, args, timeout) =>
      args.includes("ls-files") ? { code: 128, stdout: "", stderr: "fatal: unable to read the index" } : run(dir, args, timeout);
    const result = await updateProjectSettings(broken, f.dir, { previewCmd: "make check", installCmd: "make setup" }, {
      saveManifest: saveManifest(f.dir),
      settingsFile: dashboardSettingsFile(f.base, "demo"),
    });
    const test = result.steps.find((s) => s.step === "previewCmd");
    expect(test?.ok).toBe(false);
    expect(test?.error).toContain("unable to read the index");
    expect(existsSync(dashboardSettingsFile(f.base, "demo"))).toBe(false);
    expect(existsSync(join(f.dir, ".aide", "project.yaml"))).toBe(false);
    expect(readFileSync(join(f.dir, ".aide", "config"), "utf-8")).toContain("AIDE_INSTALL_CMD=make setup");
  });

  test("a tracked manifest is committed and pushed, and no settings file appears (AC-3)", async () => {
    const f = fixture({ ".aide/project.yaml": "name: demo\n" });
    const result = await updateProjectSettings(run, f.dir, { previewCmd: "make check" }, {
      saveManifest: saveManifest(f.dir),
      settingsFile: dashboardSettingsFile(f.base, "demo"),
    });
    expect(result.ok).toBe(true);
    expect(git(f.origin, "log", "-1", "--format=%s", "main").trim()).toBe("Set previewCmd from the dashboard");
    expect(git(f.origin, "show", "main:.aide/project.yaml")).toContain("previewCmd: make check");
    expect(existsSync(dashboardSettingsFile(f.base, "demo"))).toBe(false);
  });

  test("an untracked project saves previewFrom to the settings file, and origin and the checkout are untouched (AC-4)", async () => {
    const f = fixture();
    const head = git(f.dir, "rev-parse", "HEAD");
    const originHead = git(f.origin, "rev-parse", "main");
    const result = await updateProjectSettings(run, f.dir, { previewFrom: "cloudflare-pages" }, {
      saveManifest: saveManifest(f.dir),
      settingsFile: dashboardSettingsFile(f.base, "demo"),
    });
    expect(result.ok).toBe(true);
    expect(result.steps.find((s) => s.step === "previewFrom")?.ok).toBe(true);
    const parsed = parseManifest(readFileSync(dashboardSettingsFile(f.base, "demo"), "utf-8"));
    expect(parsed.ok && parsed.data.deployment?.previewFrom).toBe("cloudflare-pages");
    expect(git(f.origin, "rev-parse", "main")).toBe(originHead);
    expect(git(f.dir, "rev-parse", "HEAD")).toBe(head);
  });

  test("the value the manifest already holds writes nothing, and none against no key writes nothing (AC-5)", async () => {
    const manifest = "name: demo\ndeployment:\n  host: Cloudflare Pages\n  previewFrom: command\n";
    const tracked = fixture({ ".aide/project.yaml": manifest });
    const options = { saveManifest: saveManifest(tracked.dir), settingsFile: dashboardSettingsFile(tracked.base, "demo") };
    const saved = (await updateProjectSettings(run, tracked.dir, { previewFrom: "cloudflare-pages" }, options));
    expect(saved.ok).toBe(true);
    expect(git(tracked.origin, "show", "main:.aide/project.yaml")).toBe(manifest.replace("command", "cloudflare-pages"));
    const originHead = git(tracked.origin, "rev-parse", "main");
    const again = await updateProjectSettings(run, tracked.dir, { previewFrom: "cloudflare-pages" }, options);
    expect(again.ok).toBe(true);
    expect(git(tracked.origin, "rev-parse", "main")).toBe(originHead);

    const bare = fixture({ ".aide/project.yaml": "name: demo\n" });
    const bareHead = git(bare.origin, "rev-parse", "main");
    const none = await updateProjectSettings(run, bare.dir, { previewFrom: "none" }, {
      saveManifest: saveManifest(bare.dir),
      settingsFile: dashboardSettingsFile(bare.base, "demo"),
    });
    expect(none.ok).toBe(true);
    expect(git(bare.origin, "rev-parse", "main")).toBe(bareHead);
  });

  test("a word that is not one of the three is refused and no file is written (AC-3)", async () => {
    const f = fixture();
    const result = await updateProjectSettings(run, f.dir, { previewFrom: "vercel" }, {
      saveManifest: saveManifest(f.dir),
      settingsFile: dashboardSettingsFile(f.base, "demo"),
    });
    expect(result.ok).toBe(false);
    expect(result.steps).toEqual([
      { step: "previewFrom", ok: false, error: 'how a branch is tried must be none, command or cloudflare-pages — not "vercel"' },
    ]);
    expect(existsSync(dashboardSettingsFile(f.base, "demo"))).toBe(false);
    expect(existsSync(join(f.dir, ".aide", "project.yaml"))).toBe(false);
  });
});
