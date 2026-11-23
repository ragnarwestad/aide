// The process groups a project's steps started, kept past the step's end
// (which clears `pgid` from the job) until a check finds them gone.
import { afterEach, expect, test } from "bun:test";
import { clearStartedGroups, liveStartedGroups, noteStartedGroup } from "../../../src/queue/job-rules/started-groups.ts";

afterEach(clearStartedGroups);

test("keeps each project's groups apart, and forgets one a check finds gone (AC-1)", () => {
  noteStartedGroup("aide-test", 4242);
  noteStartedGroup("aide-test", 4243);
  noteStartedGroup("aide", 5000);
  expect(liveStartedGroups("aide-test", () => true)).toEqual([4242, 4243]);
  expect(liveStartedGroups("aide-test", (g) => g === 4243)).toEqual([4243]);
  // Gone once is gone: the id is not asked about again.
  expect(liveStartedGroups("aide-test", () => true)).toEqual([4243]);
  expect(liveStartedGroups("aide", () => true)).toEqual([5000]);
  expect(liveStartedGroups("nobody", () => true)).toEqual([]);
});
