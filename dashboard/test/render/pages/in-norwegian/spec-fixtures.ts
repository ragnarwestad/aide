// The Norwegian page states of one job and one spec: the job page for every
// job kind and state on both tabs, the spec page on every tab while active,
// archived, closed, with a running and a failed lead job and with a test
// server, and the page shell with its About dialog. Names share no word with
// the pages' English, as `fixtures.ts` asks.

import { navEntries, renderJobDetailPage, renderSpecDetail, renderProjectsPage, type JobDetailView, type SpecPageView } from "../../../../src/render";
import { JOB_STATES } from "../../../../src/queue/steps.ts";
import { SPEC_TABS } from "../../../../src/render/pages/spec-page/tabs.ts";
import { JOB_TABS } from "../../../../src/render/pages/job-page";
import { hostname } from "node:os";
import { clearCheckoutFaults } from "../../../../src/render/ui/checkout-faults.ts";
import { forgetChecks } from "../../../../src/render/ui/tool-checks.ts";
import { setPendingRestartNotice } from "../../../../src/render/ui/pending-restart.ts";
import type { PageState } from "./fixtures.ts";

const AT = "2026-11-03T08:00:00.000Z";
const NOW = "2026-11-03T08:05:00.000Z";
const NOW_MS = Date.parse(NOW);
const nb = "nb" as const;
const NAV = [
  { label: "Running", path: "/" }, { label: "Specs", path: "/specs" },
  { label: "Projects", path: "/projects" }, { label: "Schedule", path: "/schedule" },
];

const KINDS: { step: string; folder: string }[] = [
  { step: "implement", folder: "12-sildefangst" },
  { step: "schedule", folder: "schedule:kvitsyl/tunfisk" },
  { step: "deploy", folder: "deploy" },
  { step: "cleanup", folder: "cleanup" },
  { step: "close", folder: "12-sildefangst" },
  { step: "reopen", folder: "12-sildefangst" },
];

const DATA = [
  "kvitsyl", "12-sildefangst", "Sildefangst", "schedule:kvitsyl/tunfisk", "tunfisk", "kvikk", "a3f9c21",
  "1-description.md", "2-analysis.md", "3-solution.md", "4-status.md", "Fangsten er god.", "Ingen funn.",
  "aide/12-sildefangst", "localhost:4100", "abc1234", "brukerens grunn",
];

const detail = (step: string, folder: string, state: JobDetailView["state"]): JobDetailView => {
  const ended = state !== "running" && state !== "queued";
  return {
    id: `jobb-${step}-${state}`, project: "kvitsyl", specFolder: folder, title: "Sildefangst",
    steps: [step], stepIndex: 0, state, spentUsd: 0.5, timeoutSec: 1200, createdAt: AT, startedAt: AT,
    model: "kvikk",
    ...(ended ? { finishedAt: NOW } : {}),
    results: ended
      ? [{ step, ok: state === "done", costUsd: 0.5, costMeasured: false, at: AT, aiModel: "kvikk",
        terminalReason: state === "done" ? "completed" : state === "stopped" ? "timeout" : state === "cancelled" ? "cancelled" : "cli-error" }]
      : [],
    ...(state === "running" ? { runningStep: { step, logs: [] } } : {}),
    phase: { label: "3-solution.md", text: "Fangsten er god.", sha: "a3f9c21deadbeef", at: AT },
  } as JobDetailView;
};

export function jobPageStates(): PageState[] {
  const states: PageState[] = [];
  for (const { step, folder } of KINDS) {
    for (const state of JOB_STATES) {
      for (const tab of JOB_TABS) {
        states.push({
          page: `Job › ${step}, ${state}, ${tab}`,
          html: renderJobDetailPage(detail(step, folder, state), NOW, NAV, { lang: nb, tab, now: NOW_MS }),
          data: DATA,
        });
      }
    }
  }
  return states;
}

const file = (label: string, text: string | null) => ({ label, text, sha: "a3f9c21deadbeef", at: AT });

const view = (extra: Partial<SpecPageView> = {}): SpecPageView => ({
  project: "kvitsyl", specFolder: "12-sildefangst", title: "Sildefangst",
  files: [
    file("1-description.md", "Fangsten er god."), file("2-analysis.md", "Ingen funn."),
    file("3-solution.md", null), file("4-status.md", "Ingen funn."),
  ],
  updateAction: "/oppdater", saveAction: "/lagre", tickAction: "/kryss", trackingAction: "/spor",
  closeAvailable: true, steps: [], done: ["create"],
  ...extra,
});

export function specPageStates(): PageState[] {
  const variants: [string, Partial<SpecPageView>][] = [
    ["active", {}],
    ["archived", { archived: true, closeAvailable: undefined, done: ["create", "analyze", "implement", "archive"] }],
    ["closed", { archived: true, closed: true, closedDate: "2026-11-03", closeReason: "brukerens grunn", closeAvailable: undefined }],
    ["a running lead job", { lead: detail("implement", "12-sildefangst", "running") }],
    ["a failed lead job", { lead: detail("implement", "12-sildefangst", "failed"), steps: detail("implement", "12-sildefangst", "failed").results }],
    ["a test server", {
      testServerAction: "/start", testServerStopAction: "/stopp", testServerOpenHref: "/apne",
      testServer: { status: "running", branch: "aide/12-sildefangst", commit: "abc1234", url: "http://localhost:4100" },
    }],
  ];
  const states: PageState[] = [];
  for (const [name, extra] of variants) {
    for (const tab of SPEC_TABS) {
      states.push({
        page: `Spec › ${name}, ${tab}`,
        html: `<main>${renderSpecDetail(view(extra), { tab, now: NOW_MS, lang: nb })}</main>`,
        data: DATA,
      });
    }
  }
  return states;
}

/** The page shell around any page, with its header, menus and About dialog. */
export function shellStates(): PageState[] {
  // The banners the header draws from process-wide state, left by another
  // test file in the same process, are not this page's words.
  clearCheckoutFaults();
  forgetChecks();
  setPendingRestartNotice([]);
  return [{
    page: "Page shell › header and About",
    html: renderProjectsPage([], NOW, navEntries(), { lang: nb }),
    data: [...DATA, process.env.AIDE_DASH_HOST ?? hostname()],
    read: "body",
  }];
}
