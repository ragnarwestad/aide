import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { isBoardPage, placePage } from "../../../src/specs-client/page-swap/place";

let win: Window | undefined;
afterEach(async () => { await win?.happyDOM.close(); win = undefined; });

function page(html: string) {
  win = new Window({ url: "http://board.test/specs" });
  win.document.write(html);
  return win.document as unknown as Document;
}

test("keeps the shell and puts the next board page in place (AC-1, AC-3, AC-4)", () => {
  const doc = page(`<html lang="en"><head><title>Old</title></head><body data-page="old"><header><b>Old</b></header><p class="rowmsg">old</p><nav class="tabbar"><a>Old</a></nav><main>Old</main><dialog class="about"></dialog><dialog id="leaveapp"></dialog></body></html>`);
  const header = doc.querySelector("header");
  const tabs = doc.querySelector("nav.tabbar");
  const next = new win!.DOMParser().parseFromString(`<html lang="nb"><head><title>Ny</title><meta name="aide-waiting" content="2"></head><body data-page="new"><header><b>Ny</b></header><p class="rowmsg">ny</p><nav class="tabbar"><a>Ny</a></nav><main>Ny side</main><dialog class="about"></dialog></body></html>`, "text/html") as unknown as Document;
  expect(isBoardPage(next, new URL("http://board.test/settings"))).toBe(true);
  placePage(doc, next);
  expect(doc.querySelector("header")).toBe(header);
  expect(doc.querySelector("nav.tabbar")).toBe(tabs);
  expect(doc.title).toBe("Ny");
  expect(doc.documentElement.lang).toBe("nb");
  expect(doc.querySelector("main")?.textContent).toBe("Ny side");
  expect(doc.querySelector(".rowmsg")?.textContent).toBe("ny");
  expect(doc.querySelector("meta[name='aide-waiting']")?.getAttribute("content")).toBe("2");
});

test("rejects an answer that is not a board page (AC-5)", () => {
  const doc = page(`<html><body><main>Missing shell</main></body></html>`);
  expect(isBoardPage(doc, new URL("http://board.test/specs"))).toBe(false);
});
