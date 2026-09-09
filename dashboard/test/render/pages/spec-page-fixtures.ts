// Shared test data for the spec-page suite, split by theme across
// spec-page-overview-and-tabs.test.ts, spec-page-description-and-depends.test.ts,
// spec-page-phase-chain-and-checks.test.ts and spec-page-reopen-and-reset.test.ts
// (split out of spec-page.test.ts).
//
// Spec 150: the dashboard never showed a spec — it showed jobs.
//
// Every link on a spec's row went to one queue RUN, whose Overview
// showed the `## Description` prose and then that run's own figures.
// Nothing on the dashboard showed 2-analysis.md, 3-solution.md or
// 4-status.md — the files the analyze and implement steps exist to
// write — so a reader who wanted to know what a phase produced
// left the dashboard for GitHub or the filesystem.
//
// The spec page is the whole spec as it stands now: four files, in
// order, each stamped with the commit that last touched it.
//
// Spec 212: one TAB per file rather than all four stacked on Overview.
// Overview is the front page — where the spec stands, what it depends
// on, and the checks that are still holding it back as real boxes with
// a Save of their own — and the four documents are four tabs beside it.
// The reload that used to run on every tab is scoped to the two that
// move while a step runs, because a page that reloads on a timer wipes
// a half-typed textarea and a half-ticked list.

import { renderSpecPage, type JobDetailView, type SpecPageView } from "../../../src/render.ts";
import type { Language } from "../../../src/i18n";

export const NAV = [{ label: "Overview", path: "projects.html" }];
export const GENERATED = "2026-08-21T10:05:00Z";
export const NOW = Date.parse("2026-08-21T10:05:00Z");

export const file = (name: string, text: string | null, extra: Partial<SpecPageView["files"][number]> = {}) => ({
  label: name,
  text,
  sha: "a3f9c21deadbeef",
  at: "2026-08-21T09:14:00+02:00",
  ...extra,
});

export const view = (extra: Partial<SpecPageView> = {}): SpecPageView => ({
  project: "aide",
  specFolder: "150-one-page-shows-the-whole-spec",
  title: "One page shows the whole spec",
  files: [
    file("1-description.md", "## Description\n\nThe dashboard never shows a spec.\n"),
    file("2-analysis.md", "## Findings\n\n`discover.ts` has specTitle().\n"),
    file("3-solution.md", "## Recommended solution\n\nApproach 1.\n"),
    file("4-status.md", "## Phase 1: RED\n\n| Task | Status |\n"),
  ],
  updateAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/update",
  saveAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/save",
  tickAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/tick",
  trackingAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/tracking",
  ...extra,
});

export const lead = (extra: Partial<JobDetailView> = {}): JobDetailView => ({
  id: "job-1234",
  project: "aide",
  specFolder: "150-one-page-shows-the-whole-spec",
  steps: ["implement"],
  stepIndex: 0,
  state: "done",
  spentUsd: 1.5,
  timeoutSec: 1200,
  createdAt: "2026-08-21T09:00:00Z",
  results: [],
  ...extra,
});

export const page = (v: SpecPageView = view(), tab?: string, lang?: Language) =>
  renderSpecPage(v, GENERATED, NAV, { tab, now: NOW, lang });
