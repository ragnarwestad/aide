// The dialog inside the Deploy form: the five steps from the start, in
// order and waiting, in the reader's language — and no covering layer
// asked for by the form.

import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { Language } from "../../../../src/i18n";
import type { ProjectView } from "../../../../src/render";

const NAV = [{ label: "Projects", path: "/projects" }];
const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };

const deployPage = (lang: Language): string =>
  renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-08-31T00:00:00Z", NAV, {
    worktreeLinkCandidates: [],
    editing: false,
    tab: "deploy",
    drift: { behind: 2, checkedAt: 1735689600000 },
    lang,
  });

const dialogOf = (html: string): string => html.match(/<dialog[^>]*data-deploy-dialog[\s\S]*?<\/dialog>/)?.[0] ?? "";
const lines = (dialog: string): { step: string; state: string; text: string }[] =>
  [...dialog.matchAll(/<li data-step="([^"]+)" data-state="([^"]+)">(.*?)<\/li>/g)].map((m) => ({
    step: m[1]!,
    state: m[2]!,
    text: m[3]!.replace(/<[^>]*>/g, "").trim(),
  }));

describe("the Deploy form's dialog", () => {
  test("lists the five steps in order, each waiting, in English (AC-2)", () => {
    expect(lines(dialogOf(deployPage("en")))).toEqual([
      { step: "fetch", state: "waiting", text: "Fetch from origin waiting" },
      { step: "install", state: "waiting", text: "Install waiting" },
      { step: "restart", state: "waiting", text: "Restart the service waiting" },
      { step: "wait", state: "waiting", text: "Wait for the service to answer waiting" },
      { step: "check", state: "waiting", text: "Check that the service runs the newest commit waiting" },
    ]);
  });

  test("lists the same five in Norwegian (AC-2)", () => {
    const nb = lines(dialogOf(deployPage("nb")));
    expect(nb.map((l) => l.step)).toEqual(["fetch", "install", "restart", "wait", "check"]);
    expect(nb.every((l) => l.state === "waiting")).toBe(true);
    expect(nb[0]!.text).toBe("Hent fra origin venter");
    expect(nb[4]!.text).toContain("nyeste committen");
  });

  test("sits inside the form, and the form does not ask for the covering layer (AC-1)", () => {
    const html = deployPage("en");
    const form = html.match(/<form[^>]*class="deployform"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain("data-deploy-dialog");
    expect(form).not.toContain("data-overlay");
  });

  test("carries the state words, the failed-step sentence and the silent-service sentence, and no Close button (AC-5)", () => {
    const dialog = dialogOf(deployPage("nb"));
    expect(dialog).toMatch(/<template data-deploy-error><p class="deploy-error rowmsg failed">/);
    expect(dialog).toContain('data-failed="feilet"');
    expect(dialog).toContain('data-failed-at="{step} feilet: {error}"');
    expect(dialog).toContain('data-no-answer="tjenesten svarte ikke etter omstarten');
    expect(dialog).not.toContain("data-deploy-close");
  });

  test("the Deploy tab draws a kept failure with its step's label in the page's language, ahead of the address's error (AC-6)", () => {
    const html = renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-08-31T00:00:00Z", NAV, {
      worktreeLinkCandidates: [],
      editing: false,
      tab: "deploy",
      drift: { behind: 2, checkedAt: 1735689600000 },
      deployFailure: { step: "install", error: "kommandoen feilet" },
      deployError: "fra adressen",
      lang: "nb",
    });
    const shown = html.match(/<p class="refusal deploy-error rowmsg failed">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]*>/g, "");
    expect(shown).toBe("Installer feilet: kommandoen feilet");
    expect(html).not.toContain("fra adressen");
  });
});
