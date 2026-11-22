import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { holdOpenFilterMenu } from "../../src/specs-client/filter-menu-hold.ts";

afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const MENU = '<details class="menu" data-filter="state"><summary>State</summary><div class="menupanel"><a href="?state=failed">Failed</a></div></details>';

function install(open: boolean): HTMLElement {
  GlobalRegistrator.register({ url: "http://board.test/specs" });
  document.body.innerHTML = `<div id="jobrows">${open ? MENU.replace("<details", "<details open") : MENU}</div>`;
  return document.getElementById("jobrows")!;
}

const menuIn = (root: HTMLElement) => root.querySelector<HTMLDetailsElement>("details.menu")!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an open menu the redraw replaces is opened again", () => {
  const root = install(true);
  const reopen = holdOpenFilterMenu(root);
  root.innerHTML = MENU;
  reopen();
  expect(menuIn(root).open).toBe(true);
});

test("a menu the reader closes during the redraw stays closed", () => {
  const root = install(true);
  const reopen = holdOpenFilterMenu(root);
  menuIn(root).open = false;
  reopen();
  expect(menuIn(root).open).toBe(false);
});

test("a menu the redraw replaced and the reader then closed stays closed", async () => {
  const root = install(true);
  const reopen = holdOpenFilterMenu(root);
  root.innerHTML = MENU.replace("<details", "<details open");
  await settle();
  menuIn(root).open = false;
  await settle();
  reopen();
  expect(menuIn(root).open).toBe(false);
});
