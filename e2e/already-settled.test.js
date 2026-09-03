// A draft that outlived its pull request.
//
// The queue is the drafts, so nothing takes an entry off it when the pull
// request underneath is merged or closed. The reader opening one has to be
// told, and the telling costs nothing: the state rides the same /pulls/{n}
// response the head commit already comes from.

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

describe("Opening a pull request that was merged behind the draft", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      objects: written(aDraft()),
      pull: { state: "closed", merged: true, merged_at: "2026-08-30T10:00:00Z", closed_at: "2026-08-30T10:00:00Z" },
    });
    await attachStorage(page);
    await page.until('document.querySelector("#blurb .settled-chip")', "the chip to arrive");
  });

  after(() => page.close());

  test("the rail says merged, beside the number, in the good tone", async () => {
    assert.equal(await page.text("#blurb .settled-chip"), "merged");
    assert.equal(await page.count("#blurb .settled-chip.is-ok"), 1);
  });
});
