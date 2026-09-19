// The acceptance-criteria hold-back is not a sentence an archive run
// wrote but a fixed English marker the board derives from the file
// itself (ACCEPTANCE_CRITERIA_UNTICKED_NOTE) — so a Norwegian row read
// "arkivering holdt tilbake: the Acceptance criteria are not all ticked
// yet — …", half in each language (427, 2026-09-09). The marker renders
// from its catalogue entry; every other reason is shown as written.
import { describe, expect, test } from "bun:test";
import { heldBackReasonText, specNotice } from "../../../../src/render/ui/job-state/notice.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../src/project/parse-status";

describe("the acceptance-criteria hold-back reads in the reader's language", () => {
  test("the row's notice, in Norwegian, has no English in it", () => {
    const notice = specNotice(undefined, ACCEPTANCE_CRITERIA_UNTICKED_NOTE, undefined, undefined, [], "nb");
    expect(notice?.text).toBe(
      "Arkiver holdt tilbake: ikke alle punktene under Akseptansekriterier er avkrysset — kryss dem av under › på Specs-lista, eller på Status-fanen",
    );
  });

  test("in English it is the catalogue's sentence, not the raw marker", () => {
    const notice = specNotice(undefined, ACCEPTANCE_CRITERIA_UNTICKED_NOTE, undefined, undefined, [], "en");
    expect(notice?.text).toBe("Archive held back: the Acceptance criteria are not all ticked — tick them under › on the Specs list, or on the Status tab");
  });

  test("every language names the Status tab, and none the Checks tab (AC-14)", () => {
    const named = { en: "Status tab", nb: "Status-fanen", de: "Tab Status", es: "pestaña Status", fr: "onglet Status" } as const;
    for (const [lang, word] of Object.entries(named)) {
      const text = specNotice(undefined, ACCEPTANCE_CRITERIA_UNTICKED_NOTE, undefined, undefined, [], lang as "en")?.text ?? "";
      expect([lang, text.includes(word)]).toEqual([lang, true]);
      expect([lang, /Checks|Sjekker/.test(text)]).toEqual([lang, false]);
    }
  });

  test("a reason an archive run wrote is shown as written", () => {
    expect(heldBackReasonText("nb", "depends on 12, which is not archived yet")).toBe("depends on 12, which is not archived yet");
  });
});
