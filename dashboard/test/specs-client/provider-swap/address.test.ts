// Which links the Providers tab puts in place without loading the page.
import { expect, test } from "bun:test";
import { providersAddress } from "../../../src/specs-client/provider-swap";

const HERE = "http://board.test/settings?tab=providers&provider=claude";

test("a link that stays on the Providers tab is put in place", () => {
  expect(providersAddress("/settings?tab=providers&provider=codex", HERE)?.searchParams.get("provider")).toBe("codex");
  expect(providersAddress("/settings?tab=providers&provider=claude&aitab=installation", HERE)).not.toBeNull();
});

test("a link to another tab, another page or another site loads as a link does", () => {
  expect(providersAddress("/settings?tab=phases", HERE)).toBeNull();
  expect(providersAddress("/specs", HERE)).toBeNull();
  expect(providersAddress("http://elsewhere.test/settings?tab=providers", HERE)).toBeNull();
});
