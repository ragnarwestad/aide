// The acceptance-criteria hold-back is not a sentence an archive run
// wrote but a fixed English marker the board derives from the file
// itself (ACCEPTANCE_CRITERIA_UNTICKED_NOTE) — so a Norwegian row read
// "arkivering holdt tilbake: the Acceptance criteria are not all ticked
// yet — …", half in each language (427, 2026-09-09). The marker renders
// from its catalogue entry; every other reason is shown as written.
import { describe, expect, test } from "bun:test";
import { heldBackReasonText, specNotice } from "../../../../src/render/ui/job-state/notice.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../src/project/parse-status.ts";

describe("the acceptance-criteria hold-back reads in the reader's language", () => {
  test("the row's notice, in Norwegian, has no English in it", () => {
    const notice = specNotice(undefined, ACCEPTANCE_CRITERIA_UNTICKED_NOTE, undefined, undefined, [], "nb");
    expect(notice?.text).toBe(
      "Arkivering holdt tilbake: Ikke alle punktene under Akseptansekriterier er avkrysset — kryss dem av på Sjekker-fanen",
    );
  });

  test("in English it is the catalogue's sentence, not the raw marker", () => {
    const notice = specNotice(undefined, ACCEPTANCE_CRITERIA_UNTICKED_NOTE, undefined, undefined, [], "en");
    expect(notice?.text).toBe("Archive held back: The Acceptance criteria are not all ticked — tick them on the Checks tab");
  });

  test("a reason an archive run wrote is shown as written", () => {
    expect(heldBackReasonText("nb", "depends on 12, which is not archived yet")).toBe("depends on 12, which is not archived yet");
  });
});
