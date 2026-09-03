import { expect, test } from "bun:test";
import { facts } from "../src/facts.ts";

test("the list starts with the fact this project is here for", () => {
  expect(facts[0]).toContain("machinery");
});
