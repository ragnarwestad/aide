// Reopen asks in a dialog on the spec page and over the list; the page it
// once asked on is gone, and its address answers as any unknown one does.

import { afterEach, describe, expect, test } from "bun:test";
import { STAMPED, harness, start } from "../../../archived/archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

describe("GET /specs/<project>/<spec>/reopen", () => {
  test("answers 404 for an archived spec, with the list's fields or without (AC-6)", async () => {
    const { base } = start();
    for (const query of ["", "?fromList=1&view.state=archived"]) {
      const res = await fetch(`${base}/specs/aide/${STAMPED}/reopen${query}`);
      expect(res.status).toBe(404);
    }
  });
});
