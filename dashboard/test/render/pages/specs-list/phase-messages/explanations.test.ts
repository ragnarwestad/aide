import { describe, expect, test } from "bun:test";
import { t } from "../../../../../src/i18n";
import { stopSentence } from "../../../../../src/render/ui/job-state/word-phase.ts";
import type { QueueRowView } from "../../../../../src/render";
import type { Phase } from "../../../../../src/render/pages/specs-list/data-model";
import { phaseExplanations } from "../../../../../src/render/pages/specs-list/phase-messages/explanations.ts";
import { prErrorSentence } from "../../../../../src/render/pages/specs-list/row-shared.ts";
import { noPullRequest, row } from "../../fixtures.ts";

// What a phase's log says about the phase's state, beside its transcript:
// the explanations its State/Action cell no longer carries.

const phase = (step: string, extra: Partial<Phase> = {}): Phase => ({ step, attempts: [], history: {}, ...extra });
const group = (extra: { analyzeStale?: boolean; done?: string[] } = {}) => ({ done: ["create"], analyzeStale: false, ...extra });
const ended = (step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
  row({ steps: [step], stepIndex: 0, state: "done", ...extra });

describe("phaseExplanations", () => {
  test("a description changed since the analysis is said on the analysis phase and no other (AC-2)", () => {
    const g = group({ analyzeStale: true });
    expect(phaseExplanations(g, phase("analyze"), "en")).toEqual([t("en", "list.descriptionChangedSince")]);
    for (const step of ["create", "implement", "archive"]) expect(phaseExplanations(g, phase(step), "en")).toEqual([]);
  });

  test("the explanation is gone once the analysis is up to date, and follows the language (AC-2)", () => {
    expect(phaseExplanations(group(), phase("analyze"), "en")).toEqual([]);
    expect(phaseExplanations(group({ analyzeStale: true }), phase("analyze"), "nb")).toEqual([t("nb", "list.descriptionChangedSince")]);
  });

  test("a pull request the latest attempt could not open is said, and a newer attempt that opened one clears it (AC-4)", () => {
    const archived = group({ done: ["create", "analyze", "implement", "archive"] });
    const failed = ended("archive", noPullRequest("archive"));
    expect(phaseExplanations(archived, phase("archive", { attempts: [failed] }), "en")).toEqual([prErrorSentence("en")]);
    const opened = ended("archive", { id: "job-new", results: [{ step: "archive", ok: true, costUsd: 0, terminalReason: "completed" }] });
    expect(phaseExplanations(archived, phase("archive", { attempts: [opened, failed] }), "en")).toEqual([]);
  });

  test("the phase's own qualifier is said together with the other explanations, each once (AC-4)", () => {
    const stopped = phase("analyze", { history: { stopped: "provider-limit" } });
    const said = phaseExplanations(group({ analyzeStale: true }), stopped, "en");
    expect(said).toHaveLength(2);
    expect(said[0]).toBe(t("en", "list.descriptionChangedSince"));
    expect(said[1]).toContain(stopSentence("provider-limit", "en"));
    expect(new Set(said).size).toBe(said.length);
  });

  test("a phase with nothing to add has no explanations (AC-4)", () => {
    expect(phaseExplanations(group({ done: ["create", "analyze"] }), phase("analyze", { attempts: [ended("analyze")] }), "en")).toEqual([]);
  });
});
