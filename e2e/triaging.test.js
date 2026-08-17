// Triaging an issue, end to end.
//
// The same seam as reviewing.test.js: real Chrome, the real server, the real
// interface, and a fetch that answers for the bucket and for GitHub's issue
// endpoints. What is under test is the whole triage path - an issue on the
// queue, the proposed rewrite cut into hunks, a rejection that survives a
// reload, the send that patches the ticket and comments on it, and the guard
// that refuses to overwrite a ticket that moved.
//
// One page, one session: two issues are on the queue so the happy path can
// post the first and the guard can refuse the second.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { openBrowser } from "./support/browser.js";
import { serveSite } from "./support/site.js";
import {
  anIssue,
  anIssueDraft,
  attachStorage,
  drawn,
  openApp,
  theIssueBody,
  written,
} from "./support/harness.js";

let site;
let browser;

before(async () => {
  [site, browser] = await Promise.all([serveSite(), openBrowser()]);
});

after(async () => {
  await browser.stop();
  site.stop();
});

// The Description row in the rail, found the way a reader finds it: by name.
const DESCRIPTION_LENS =
  '[...document.querySelectorAll("#analysis .lens")].find((lens) => lens.querySelector(".name").textContent === "Description")';

// Rejecting the first hunk keeps the reporter's title line; the tail still
// gains the expected result. Stated literally so the assertion cannot be the
// differ agreeing with itself.
const KEPT_BODY = `${theIssueBody()}\n\nExpected: a CSV of the listed orders downloads.`;

describe("Triaging an issue the agent drafted", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      pulls: [],
      issues: [
        anIssue(),
        anIssue({ number: 9, title: "Totals wrong", html_url: "https://github.com/org/app/issues/9" }),
      ],
      issueBodies: { "org/app#7": theIssueBody(), "org/app#9": theIssueBody() },
      objects: {
        ...written(anIssueDraft()),
        ...written(
          anIssueDraft({ number: 9, title: "Totals wrong", url: "https://github.com/org/app/issues/9" }),
        ),
      },
    });
    await attachStorage(page);
    await page.until(
      'document.querySelector("#head-title").textContent === "Export never finishes"',
      "the drafted triage to open by itself",
    );
  });

  after(() => page.close());

  test("the issue is on the queue and opens with a description, not a diff", async () => {
    assert.equal(await page.text("#queue-waiting"), "2 to review");

    // No diff to hang anything on: no files listed, no comments staged, and no
    // verdict on offer - dismissing is the one choice left visible.
    assert.equal(await page.count("#files .file"), 0);
    assert.equal(await page.text("#staged"), "");
    assert.deepEqual(
      await page.eval(
        '[...document.querySelectorAll("#verdict-popover button")].filter((b) => !b.hidden).map((b) => b.dataset.event)',
      ),
      ["DISMISS"],
    );

    await page.clickWhere(DESCRIPTION_LENS, "the Description row");
    await page.until('!document.querySelector("#tab-description").hidden', "the description pane");

    assert.equal(await page.count("#description .description-hunk"), 2);
    assert.match(await page.text("#description .description-result .body"), /Orders export/);
  });

  test("rejecting a hunk recomputes the final body, and survives a reload", async () => {
    await page.clickButton("#description .description-hunk:first-of-type", "Reject");
    await page.until(
      'document.querySelectorAll("#description .description-hunk.is-rejected").length === 1',
      "the rejection to land",
    );

    assert.equal(await page.text("#description .description-result .body"), KEPT_BODY);

    await page.go();
    await drawn(page);
    await page.until(
      'document.querySelector("#head-title").textContent === "Export never finishes"',
      "the reopened triage",
    );
    await page.clickWhere(DESCRIPTION_LENS, "the Description row");
    await page.until('!document.querySelector("#tab-description").hidden', "the description pane");

    assert.equal(await page.count("#description .description-hunk.is-rejected"), 1);
    assert.equal(await page.text("#description .description-result .body"), KEPT_BODY);
  });

  test("the sheet says what a triage sends, and the send is exactly that", async () => {
    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");

    assert.equal(await page.text("#confirm-target"), "org/app#7");
    assert.equal(await page.text("#confirm-count"), "posts a comment · description: 1 of 2 changes kept");
    assert.equal(await page.eval('document.querySelector("#confirm-verdict").hidden'), true);

    await page.click("#confirm-post");
    await page.until('!document.querySelector("#celebrate").hidden', "the triage to land");

    const sent = await page.eval("globalThis.__world.sent");

    assert.equal(sent.length, 2);
    assert.equal(sent[0].what, "patch-issue");
    assert.equal(sent[0].key, "org/app#7");
    assert.equal(sent[0].body.body, KEPT_BODY, "the rejected hunk's change must be absent");
    assert.equal(sent[1].what, "issue-comment");
    assert.equal(
      sent[1].body.body,
      "Retitled to the symptom and added the expected result. Your steps are untouched.",
    );
  });

  test("a posted triage is recorded, and leaves the queue", async () => {
    assert.match(await page.text("#cheer-slug"), /org\/app#7/);

    await page.click("#cheer-close");
    await page.until(
      'document.querySelector("#queue-waiting").textContent === "1 to review"',
      "the queue to let the posted triage go",
    );
  });

  test("a ticket that moved underneath the reader is refused, not overwritten", async () => {
    await page.click("#queue-button");
    await page.until('document.querySelector("#queue .row")', "the queue to list the other issue");
    await page.clickWhere(
      '[...document.querySelectorAll("#queue .row")].find((row) => row.textContent.includes("org/app#9"))',
      "the other issue's row",
    );
    await page.until(
      'document.querySelector("#head-title").textContent === "Totals wrong"',
      "the other issue to open",
    );
    await page.clickWhere(DESCRIPTION_LENS, "the Description row");
    await page.until('!document.querySelector("#tab-description").hidden', "the description pane");
    assert.equal(await page.count("#description .description-hunk"), 2);

    // The reporter edits the ticket while the reader is looking at it.
    const moved = `${theIssueBody()}\n\nalso happens in safari`;

    await page.eval(`globalThis.__world.issueBodies.set("org/app#9", ${JSON.stringify(moved)})`);

    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");
    await page.click("#confirm-post");

    // The guard closes the sheet, says why, and nothing new leaves: the two
    // sends on record are still the first issue's.
    await page.until('document.querySelector("#confirm").hidden', "the sheet to refuse");
    assert.match(await page.text("#status"), /the ticket changed since you read it/);
    assert.equal(await page.eval("globalThis.__world.sent.length"), 2, "no PATCH may be sent");

    // And the pane rediffs against the ticket as it now stands.
    await page.until(
      'document.querySelector("#description").textContent.includes("also happens in safari")',
      "the pane to rediff against the moved ticket",
    );
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

// The close, end to end: the sheet says it, the send orders it after the
// comment, and dropping it leaves the ticket open with only the comment sent.
// Two issues, so the live close can post first and the dropped one after it.
describe("Closing an issue the agent proposed", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      pulls: [],
      issues: [
        anIssue(),
        anIssue({ number: 9, title: "Totals wrong", html_url: "https://github.com/org/app/issues/9" }),
      ],
      issueBodies: { "org/app#7": theIssueBody(), "org/app#9": theIssueBody() },
      objects: {
        ...written(
          anIssueDraft({ description: "", close: { reason: "duplicate", of: 482 } }),
        ),
        ...written(
          anIssueDraft({
            number: 9,
            title: "Totals wrong",
            url: "https://github.com/org/app/issues/9",
            description: "",
            close: { reason: "not_planned" },
          }),
        ),
      },
    });
    await attachStorage(page);
    await page.until(
      'document.querySelector("#head-title").textContent === "Export never finishes"',
      "the drafted triage to open by itself",
    );
  });

  after(() => page.close());

  test("the footer and the sheet both say the close, in the same words", async () => {
    assert.equal(await page.text("#staged"), "closes as duplicate of #482");

    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");

    assert.equal(
      await page.text("#confirm-count"),
      "posts a comment · description unchanged · closes as duplicate of #482",
    );
    assert.match(await page.text("#confirm-preview .close-plan"), /closes as duplicate of #482/);
  });

  test("posting sends the comment, then the close, and nothing else", async () => {
    await page.click("#confirm-post");
    await page.until('!document.querySelector("#celebrate").hidden', "the triage to land");

    const sent = await page.eval("globalThis.__world.sent");

    assert.equal(sent.length, 2);
    assert.equal(sent[0].what, "issue-comment");
    assert.equal(sent[0].key, "org/app#7");
    assert.equal(sent[1].what, "close-issue");
    assert.equal(sent[1].key, "org/app#7");
    assert.deepEqual(sent[1].body, { state: "closed", state_reason: "duplicate" });
  });

  test("dropping the close posts only the comment, and the ticket stays open", async () => {
    await page.click("#cheer-close");
    await page.click("#queue-button");
    await page.until('document.querySelector("#queue .row")', "the queue to list the other issue");
    await page.clickWhere(
      '[...document.querySelectorAll("#queue .row")].find((row) => row.textContent.includes("org/app#9"))',
      "the other issue's row",
    );
    await page.until(
      'document.querySelector("#head-title").textContent === "Totals wrong"',
      "the other issue to open",
    );

    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");
    assert.match(await page.text("#confirm-count"), /closes as not planned/);

    await page.click("#confirm-preview .close-plan .hunk-toggle");
    await page.until(
      'document.querySelector("#confirm-count").textContent.includes("the ticket stays open")',
      "the sheet to say the ticket stays open",
    );
    assert.equal(await page.text("#staged"), "the ticket stays open");

    await page.click("#confirm-post");
    await page.until('!document.querySelector("#celebrate").hidden', "the triage to land");

    const sent = await page.eval("globalThis.__world.sent");

    assert.equal(sent.length, 3, "only the comment may follow the first issue's two sends");
    assert.equal(sent[2].what, "issue-comment");
    assert.equal(sent[2].key, "org/app#9");
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});
