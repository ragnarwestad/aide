import { expect, test } from "bun:test";
import { credentialOf } from "../../../src/queue/waiting/credential.ts";

test("the editor proves ownership without sending the queue it was handed", () => {
  const owner = { token: "t", generation: "g", revision: 3, targetId: "job:a:0", openingIds: ["job:a:0"],
    entries: [{ id: "job:a:0", label: "aide: a very long spec name · analyze", reason: "Held back: another Merge is running" }] };
  expect(credentialOf(owner)).toEqual({ token: "t", generation: "g", revision: 3 });
});
