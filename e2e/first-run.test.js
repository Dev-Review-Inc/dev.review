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

  // iOS focuses the window on the first touch and only then sends its click.
  test("the window taking focus leaves the button the finger is on in place", async () => {
    await page.eval(`(() => {
      window.pressed = ${SAMPLE};
      window.dispatchEvent(new Event("focus"));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(await page.eval("window.pressed.isConnected"), true);
  });

  test("pressing it opens the sample data", async () => {
    await page.clickButton("#comment", "Try the sample data");
    await page.until(
      '/to review/.test(document.querySelector("#queue-button").textContent) && ' +
        '/Take the tour/.test(document.querySelector("#source-button").textContent)',
      "the sample data to be attached and its reviews queued",
    );
    await page.until(
      'document.querySelector("#head-title").textContent.includes("Paginate the orders endpoint") && ' +
        'document.body.innerText.includes("Start here.")',
      "the tour's first review to open",
    );
  });

  test("the review opens with the drawer closed, its text on top", async () => {
    assert.equal(await page.eval('document.querySelector(".pane").classList.contains("is-collapsed")'), true);
    assert.equal(await page.eval('document.querySelector("#pane-backdrop").hidden'), true);
    assert.equal(
      await page.eval('document.querySelector("#comment").contains(document.elementFromPoint(220, 478))'),
      true,
    );
  });

  test("the menu button opens the drawer over it and its backdrop closes it", async () => {
    await page.click("#pane-toggle");
    await page.until('!document.querySelector(".pane").classList.contains("is-collapsed")', "the drawer to open");

    // Below the drawer, where only the backdrop is.
    await page.clickAt(220, 940);
    await page.until('document.querySelector(".pane").classList.contains("is-collapsed")', "the drawer to close");

    assert.deepEqual(page.complaints, []);
  });

  test("picking another review from the queue leaves the drawer closed", async () => {
    await page.click("#queue-button");
    await page.clickWhere(
      '[...document.querySelectorAll("#queue .row")].find((row) => row.textContent.includes("Round the order total"))',
      "the second review's row",
    );
    await page.until(
      'document.querySelector("#head-title").textContent.includes("Round the order total")',
      "the second review to open",
    );

    assert.equal(await page.eval('document.querySelector(".pane").classList.contains("is-collapsed")'), true);
    assert.equal(await page.eval('document.querySelector("#pane-backdrop").hidden'), true);
    assert.deepEqual(page.complaints, []);
  });
});

describe("Putting the sample data back", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: {} });
  });

  after(() => page.close());

  test("lands on the tour's first review again, not on nothing", async () => {
    await page.clickButton("#comment", "Try the sample data");
    await page.until(
      'document.querySelector("#head-title").textContent.includes("Paginate the orders endpoint")',
      "the tour's first review to open",
    );

    await page.click("#queue-button");
    await page.clickWhere(
      '[...document.querySelectorAll("#queue .row")].find((row) => row.textContent.includes("Round the order total"))',
      "the second review's row",
    );
    await page.until(
      'document.querySelector("#head-title").textContent.includes("Round the order total")',
      "the second review to open",
    );

    await page.click("#signout");
    await page.until(
      'document.querySelector("#head-title").textContent.includes("Paginate the orders endpoint")',
      "the tour's first review to open again",
    );

    assert.deepEqual(page.complaints, []);
  });
});
