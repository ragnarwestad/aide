// The Norwegian page states of the lists: the Jobs tab with a row of every
// job kind in every job state and a group's card, the specs list with rows
// closed and open and a phase line for every step, the Test servers page and
// a Schedule entry's runs. Names share no word with the pages' English, as
// `fixtures.ts` asks.

import {
  renderJobsPage, renderScheduleDetailPage, renderSpecsPage, renderTestServersPage,
  type QueueRowView, type SpecTarget,
} from "../../../../src/render";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import { JOB_STATES, WORKFLOW_STEPS } from "../../../../src/queue/steps.ts";
import type { PageState } from "./fixtures.ts";

const AT = "2026-11-03T08:00:00.000Z";
const NOW = "2026-11-03T08:05:00.000Z";
const NOW_MS = Date.parse(NOW);
const nb = "nb" as const;
const NAV = [
  { label: "Running", path: "/" }, { label: "Specs", path: "/specs" },
  { label: "Projects", path: "/projects" }, { label: "Schedule", path: "/schedule" },
];

/** A spec step's folder, a kind's own folder for the jobs that are no spec's. */
const KINDS: { step: string; folder: string }[] = [
  { step: "implement", folder: "12-sildefangst" },
  { step: "schedule", folder: "schedule:kvitsyl/tunfisk" },
  { step: "deploy", folder: "deploy" },
  { step: "cleanup", folder: "cleanup" },
  { step: "close", folder: "13-torskefiske" },
  { step: "reopen", folder: "14-makrellstim" },
];

export const LIST_DATA = [
  "kvitsyl", "12-sildefangst", "13-torskefiske", "14-makrellstim", "15-laksetrapp", "16-hvalross",
  "Sildefangst", "Torskefiske", "Makrellstim", "Laksetrapp", "Hvalross", "tunfisk", "Flokken",
  "kvikk", "aide/12-sildefangst", "aide/15-laksetrapp",
];

const job = (id: string, step: string, folder: string, state: QueueRowView["state"], extra: Partial<QueueRowView> = {}): QueueRowView => ({
  id, project: "kvitsyl", specFolder: folder, steps: [step], stepIndex: 0, state,
  spentUsd: 0.5, timeoutSec: 1200, createdAt: AT, startedAt: AT,
  ...(state === "running" || state === "queued" ? {} : { finishedAt: NOW }),
  results: state === "done" ? [{ step, ok: true, costUsd: 0.5, costMeasured: true, terminalReason: "completed" }] : [],
  ...extra,
});

const targets: SpecTarget[] = ["12-sildefangst", "13-torskefiske", "14-makrellstim", "15-laksetrapp", "16-hvalross"].map(
  (specFolder) => ({ project: "kvitsyl", specFolder, title: specFolder.replace(/^\d+-/, "").replace(/^./, (c) => c.toUpperCase()) }),
);

const listOpts = (extra: Record<string, unknown> = {}) => ({
  runnerAvailable: true, createProjects: ["kvitsyl"], targets, lang: nb,
  modelChoices: [{ name: "kvikk", tool: "claude" as const }], defaultModels: { default: "kvikk" },
  ...extra,
});

export function jobsStates(): PageState[] {
  const states: PageState[] = [];
  for (const state of JOB_STATES) {
    const shown = KINDS.filter((k) => k.step !== "implement").map((k, i) => job(`jobb-${state}-${i}`, k.step, k.folder, state));
    const specJobs = [job(`jobb-${state}-spec`, "implement", "12-sildefangst", state)];
    const group: ExecutionGroup = {
      id: "flokk-1", project: "kvitsyl", name: "Flokken", members: ["15-laksetrapp", "16-hvalross"], branch: "group/15-laksetrapp",
      // A group runs beside running jobs, and offers Stop; otherwise it is prepared, and offers Start.
      state: state === "running" ? "running" : "prepared", createdAt: AT, completedMembers: [], jobs: [],
    };
    states.push({
      page: `Jobs › every kind, ${state}`,
      html: renderJobsPage({ shown, specJobs, executionGroups: [group], list: listOpts(), now: NOW_MS }, NOW, NAV),
      data: LIST_DATA,
    });
  }
  return states;
}

export function specsListStates(): PageState[] {
  const open = targets.map((t) => `${t.project}/${t.specFolder}`).join(",");
  const states: PageState[] = [];
  for (const state of JOB_STATES) {
    const rows = [job(`jobb-${state}`, "implement", "12-sildefangst", state), job(`jobb-${state}-a`, "analyze", "13-torskefiske", state)];
    states.push(
      { page: `Specs › rows closed, ${state}`, html: renderSpecsPage(rows, NOW, NAV, listOpts()), data: LIST_DATA },
      { page: `Specs › rows open, ${state}`, html: renderSpecsPage(rows, NOW, NAV, listOpts({ filter: { open } })), data: LIST_DATA },
    );
  }
  // A phase line for every step a job can be on.
  const everyStep = WORKFLOW_STEPS.map((step, i) => job(`jobb-steg-${i}`, step, "14-makrellstim", "failed", {
    results: [{ step, ok: false, costUsd: 0, costMeasured: true, terminalReason: "timeout" }],
  }));
  const done = targets.map((t) => ({ ...t, done: ["create", "analyze"] }));
  states.push({
    page: "Specs › a phase line for every step",
    html: renderSpecsPage(everyStep, NOW, NAV, listOpts({ targets: done, filter: { open } })),
    data: LIST_DATA,
  });
  return states;
}

export function testServerStates(): PageState[] {
  const data = ["kvitsyl", "12-sildefangst", "aide/12-sildefangst", "http://localhost:4100", "localhost:4100"];
  const rows = (["starting", "running", "failed"] as const).map((status) => ({
    project: "kvitsyl", specFolder: "12-sildefangst", specHref: "/specs/kvitsyl/12-sildefangst",
    branch: "aide/12-sildefangst", status, stopAction: "/stopp", ...(status === "running" ? { url: "http://localhost:4100" } : {}),
  }));
  return [
    { page: "Test servers › empty", html: renderTestServersPage(NAV, NOW, [], { lang: nb }), data },
    { page: "Test servers › one row in each status", html: renderTestServersPage(NAV, NOW, rows, { lang: nb }), data },
  ];
}

export function scheduleRunStates(): PageState[] {
  const entry = { name: "tunfisk", cron: "0 3 * * *", prompt: "rutiner/tunfisk.md", enabled: true, model: "kvikk" };
  const runs = JOB_STATES.map((state, i) => job(`kjoring-${i}`, "schedule", "schedule:kvitsyl/tunfisk", state));
  return [{
    page: "Schedule › entry › Report, a run in each state",
    html: renderScheduleDetailPage(NAV, NOW, {
      project: "kvitsyl", entry, tab: "report", runs, lang: nb,
      modelChoices: [{ name: "kvikk", tool: "claude" }], defaultModels: { default: "kvikk" },
    } as unknown as Parameters<typeof renderScheduleDetailPage>[2]),
    data: [...LIST_DATA, "rutiner/tunfisk.md"],
  }];
}
