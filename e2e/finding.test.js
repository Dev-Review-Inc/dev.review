// Finding an item by its number, end to end.
//
// Command-K opens a search over the queue from anywhere. The reader types a
// number, and Enter opens the best match.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { openBrowser } from "./support/browser.js";
import { serveSite } from "./support/site.js";
import { anIssue, anIssueDraft, attachStorage, openApp, theIssueBody, written } from "./support/harness.js";

const META = 4;

let site;
let browser;

before(async () => {
  [site, browser] = await Promise.all([serveSite(), openBrowser()]);
});

after(async () => {
  await browser.stop();
  site.stop();
});

describe("Finding an item with Command-K", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      issues: [
        anIssue(),
        anIssue({ number: 97, title: "Totals wrong", html_url: "https://github.com/org/app/issues/97" }),
      ],
      issueBodies: { "org/app#7": theIssueBody(), "org/app#97": theIssueBody() },
      objects: {
        ...written(anIssueDraft()),
        ...written(
          anIssueDraft({ number: 97, title: "Totals wrong", url: "https://github.com/org/app/issues/97" }),
        ),
      },
    });
    await attachStorage(page);
    await page.until(
      'document.querySelector("#head-title").textContent === "Export never finishes"',
      "the first triage to open by itself",
    );
  });

  after(() => page.close());

  test("opens on Command-K with the cursor in the search", async () => {
    await page.press("k", META);
    await page.until('!document.querySelector("#palette").hidden', "the search to open");

    assert.equal(await page.eval('document.activeElement.id'), "palette-input");
  });

  test("puts the exact number first, and Enter opens it", async () => {
    await page.fill("#palette-input", "97");

    assert.equal(
      await page.eval('document.querySelector("#palette-results .palette-row .palette-number").textContent'),
      "#97",
    );

    await page.press("Enter");
    await page.until(
      'document.querySelector("#head-title").textContent === "Totals wrong"',
      "#97 to open",
    );

    assert.equal(await page.eval('document.querySelector("#palette").hidden'), true);
  });

  test("closes on Escape", async () => {
    await page.press("k", META);
    await page.until('!document.querySelector("#palette").hidden', "the search to open");
    await page.press("Escape");

    assert.equal(await page.eval('document.querySelector("#palette").hidden'), true);
  });
});
