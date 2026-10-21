// The board: every pull request on the queue at once, in columns by state.
//
// One page for the group, as in reviewing.test.js: a reader switches to the
// board, finds a review, looks inside it, and opens it in the reader.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { openBrowser } from "./support/browser.js";
import { serveSite } from "./support/site.js";
import { aDraft, attachStorage, openApp, written } from "./support/harness.js";

let site;
let browser;

before(async () => {
  [site, browser] = await Promise.all([serveSite(), openBrowser()]);
});

after(async () => {
  await browser.stop();
  site.stop();
});

describe("Looking over the whole queue on the board", () => {
  let page;

  const card = (number) => `#board .board-card[data-key="org/app#${number}"]`;

  before(async () => {
    page = await openApp(browser, site.origin, {
      objects: {
        ...written(aDraft()),
        ...written(
          aDraft({
            number: 43,
            url: "https://github.com/org/app/pull/43",
            title: "Retry the webhook deliveries",
            finishedAt: undefined,
            progress: { note: "QA: 1 of 2" },
          }),
        ),
      },
    });
    await attachStorage(page);

    await page.click("#board-button");
    await page.until(`document.querySelector(${JSON.stringify(card(42))})`, "the board to draw the review");
  });

  after(() => page.close());

  test("the board takes the reader's place", async () => {
    assert.equal(await page.eval('document.querySelector("main").hidden'), true);
    assert.equal(await page.eval('document.querySelector("#board-button").getAttribute("aria-pressed")'), "true");
  });

  test("nothing can be posted from the board, since no review is on screen", async () => {
    for (const id of ["post-split", "consequence", "staged", "counts"]) {
      assert.equal(await page.eval(`document.getElementById("${id}").hidden`), true, id);
    }
    assert.equal(await page.eval('document.getElementById("status").hidden'), false);
  });

  test("each pull request sits in the column for its state", async () => {
    assert.equal(await page.eval(`document.querySelector(${JSON.stringify(card(42))}).closest(".board-column").dataset.state`), "ready");
    assert.equal(await page.eval(`document.querySelector(${JSON.stringify(card(43))}).closest(".board-column").dataset.state`), "stalled");
  });

  test("a card says which pull request it is, who wrote it, the verdict and how many findings", async () => {
    const text = await page.text(card(42));

    assert.match(text, /org\/app#42/);
    assert.match(text, /Re-root the errors onto a common base class/);
    assert.match(text, /someone/);
    assert.match(text, /comment/i);
    assert.match(text, /2 findings/);
  });

  test("a card opens in place onto its findings, grouped by kind", async () => {
    await page.click(`${card(42)} .board-expand`);
    await page.until(`document.querySelectorAll(${JSON.stringify(`${card(42)} .board-finding`)}).length === 2`, "the findings to show");

    const kinds = await page.eval(`[...document.querySelectorAll(${JSON.stringify(`${card(42)} .board-kind-name`)})].map((k) => k.textContent)`);

    assert.deepEqual(kinds, ["bug", "question"]);
    assert.match(await page.text(`${card(42)} .board-finding`), /lib\/error\.rb:12/);
    assert.match(await page.text(`${card(42)} .board-finding`), /The rescue clause now parses and never matches\./);
  });

  test("the title opens the pull request in the reader", async () => {
    await page.click(`${card(43)} .board-title`);
    await page.until('document.querySelector("#board").hidden', "the reader to come back");

    assert.equal(await page.text("#head-title"), "Retry the webhook deliveries");
    assert.equal(await page.eval('document.querySelector("main").hidden'), false);
  });
});
