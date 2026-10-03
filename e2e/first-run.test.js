// A first visit, on a phone.
//
// Nothing is attached, so there is no review to read and the pane has nothing
// in it. What the visitor must see is the empty state's way in, not a drawer.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { openBrowser } from "./support/browser.js";
import { serveSite } from "./support/site.js";
import { openApp } from "./support/harness.js";

let site;
let browser;

before(async () => {
  [site, browser] = await Promise.all([serveSite(), openBrowser()]);
});

after(async () => {
  await browser.stop();
  site.stop();
});

const SAMPLE = `[...document.querySelectorAll("#comment button")]
  .find((button) => button.textContent.trim() === "Try the sample data")`;

describe("A first visit at phone width", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: {}, viewport: { width: 440, height: 956 } });
  });

  after(() => page.close());

  test("the sample data button is on top, not under an empty drawer", async () => {
    const on = await page.eval(`(() => {
      const button = ${SAMPLE};

      if (!button) return "no button";

      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

      return button.contains(top) ? "the button" : top.outerHTML.slice(0, 80);
    })()`);

    assert.equal(on, "the button");
  });

  test("pressing it opens the sample data", async () => {
    await page.clickButton("#comment", "Try the sample data");
    await page.until(
      '/to review/.test(document.querySelector("#queue-button").textContent) && ' +
        '/Take the tour/.test(document.querySelector("#source-button").textContent)',
      "the sample data to be attached and its reviews queued",
    );
  });

  test("once a review is open, the drawer opens over it and its backdrop closes it", async () => {
    await page.click("#queue-button");
    await page.click("#queue .row.is-ready");
    await page.until('document.querySelector("#head-title").textContent.trim()', "the review to open");

    assert.equal(await page.eval('document.querySelector(".pane").classList.contains("is-collapsed")'), false);

    // Below the drawer, where only the backdrop is.
    await page.clickAt(220, 940);
    await page.until('document.querySelector(".pane").classList.contains("is-collapsed")', "the drawer to close");

    assert.deepEqual(page.complaints, []);
  });
});
