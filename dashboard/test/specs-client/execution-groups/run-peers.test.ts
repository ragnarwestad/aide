import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { fillRunPeers } from "../../../src/specs-client/execution-groups/run-peers.ts";

const label = (folder: string) =>
  `<label class="phase"><input type="checkbox" name="member" value="${folder}"> <span>${folder}</span><input name="position" type="hidden" disabled></label>`;

function page() {
  const window = new Window();
  window.document.body.innerHTML =
    `<dialog id="d"><form data-run-group><div data-run-peers="aide" data-run-self="1-own"></div></form></dialog>` +
    `<template data-run-peers-of="aide">${label("1-own")}${label("2-next")}${label("3-last")}</template>` +
    `<template data-run-peers-of="other">${label("9-elsewhere")}</template>`;
  return window.document;
}
const members = (doc: ReturnType<typeof page>) =>
  [...doc.querySelectorAll('#d input[name="member"]')].map((input) => (input as unknown as HTMLInputElement).value);

test("an opened Run dialog takes its project's peers, without its own spec", () => {
  const doc = page();
  fillRunPeers(doc.getElementById("d") as unknown as Element);
  expect(members(doc)).toEqual(["2-next", "3-last"]);
});

test("a dialog opened again keeps what it has, ticks included", () => {
  const doc = page();
  const dialog = doc.getElementById("d") as unknown as Element;
  fillRunPeers(dialog);
  (doc.querySelector('#d input[value="3-last"]') as unknown as HTMLInputElement).checked = true;
  fillRunPeers(dialog);
  expect(members(doc)).toEqual(["2-next", "3-last"]);
  expect((doc.querySelector('#d input[value="3-last"]') as unknown as HTMLInputElement).checked).toBe(true);
});
