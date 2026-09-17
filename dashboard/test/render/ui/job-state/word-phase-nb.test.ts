// Spec 482: `decidePhase()`'s own badge labels — Done/Held back/Stopped
// — were string literals never routed through the catalogue, so a phase
// line read English words on a Norwegian board.

import { describe, expect, test } from "bun:test";
import { wordPhase } from "../../../../src/render/ui/job-state";

describe("phase badges in Norwegian", () => {
  test("a finished phase reads Ferdig, not Done", () => {
    const w = wordPhase(true, undefined, undefined, {}, "nb");
    expect(w.badge?.label).toBe("Ferdig");
  });

  test("a held-back phase reads Holdt tilbake, not Held back", () => {
    const w = wordPhase(false, { reason: "depends on 1-x" }, undefined, {}, "nb");
    expect(w.badge?.label).toBe("Holdt tilbake");
  });

  test("a stopped phase reads Stoppet, not Stopped", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "not-implemented-yet", step: "archive" }, "nb");
    expect(w.badge?.label).toBe("Stoppet");
  });

  test("English is unchanged", () => {
    expect(wordPhase(true, undefined, undefined, {}, "en").badge?.label).toBe("Done");
    expect(wordPhase(false, { reason: "x" }, undefined, {}, "en").badge?.label).toBe("Held back");
    expect(
      wordPhase(false, undefined, undefined, { stopped: "not-implemented-yet", step: "archive" }, "en").badge?.label,
    ).toBe("Stopped");
  });
});
