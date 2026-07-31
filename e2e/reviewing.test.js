// The journeys, end to end.
//
// Real Chrome, the real page served by serve/ under its real content security
// policy, the real modules, the real event store in the browser's own
// IndexedDB. One thing is a stand-in: `fetch`, which is where the bucket and
// GitHub would be. That seam is the whole reason this can run in a commit hook
// with no credential anywhere near it, and it is drawn as low as it goes, so
// the S3 adapter, the signing, the GitHub destination and every line of the
// interface above them are the ones under test.
//
// The tests inside a group share one page on purpose. A reader arrives, attaches
// their storage, reads a review, changes their mind about a comment and posts:
// that is one session, and asserting on it as one is both truer and faster than
// rebuilding the world five times.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { openBrowser } from "./support/browser.js";
import { serveSite } from "./support/site.js";
import { aDraft, aPull, attachStorage, drawn, openApp, written } from "./support/harness.js";

let site;
let browser;

before(async () => {
  [site, browser] = await Promise.all([serveSite(), openBrowser()]);
});

after(async () => {
  await browser.stop();
  site.stop();
});

describe("Arriving with nothing attached", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: {} });
  });

  after(() => page.close());

  test("the interface starts, and says there is nothing behind it yet", async () => {
    assert.equal(await page.text("#source-name"), "none");
    assert.equal(await page.text("#queue-waiting"), "nothing to review");
    assert.equal(await page.eval('document.querySelector("#post").disabled'), true);
  });

  test("the setup popover offers the storage this browser can actually use", async () => {
    await page.click("#source-button");
    await page.until('!document.querySelector("#setup-popover").hidden', "the setup popover");

    const offered = await page.eval(
      '[...document.querySelectorAll("#source-form select option")].map((o) => o.value)',
    );

    // Never the in-memory one: it would look like it worked until a reload.
    assert.ok(offered.includes("s3"));
    assert.ok(!offered.includes("memory"));
  });

  test("nothing went wrong on the way in", () => {
    assert.deepEqual(page.complaints, []);
  });
});

// Everything the interface needs comes from somewhere else, and each piece
// used to be drawn the moment it landed: the queue, then the source's health,
// then the review that opens by itself, then its diff. This watches a start up
// with all of it configured and holds it to one arrival.
describe("Arriving all at once", () => {
  let page;
  let arrival;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);

    // The realistic start up: a browser coming back to a source, a destination
    // and a queue it already has, rather than the first ever load.
    await page.go();
    await drawn(page);

    // The first moment the reader can see anything, held for comparison.
    arrival = await page.eval('document.querySelector("#shell").innerText');
  });

  after(() => page.close());

  test("the whole interface is there the moment the curtain lifts", async () => {
    assert.equal(await page.text("#source-name"), "Work");
    assert.equal(await page.text("#queue-waiting"), "1 to review");
    assert.equal(await page.text("#head-title"), "Re-root the errors onto a common base class");
    assert.equal(await page.text("#staged"), "2 comments staged");

    // The diff is the last thing to land, and the one the reader used to watch
    // appear a beat after everything else.
    assert.ok((await page.count("#diff .diff-file")) > 0);
  });

  // Redrawing is allowed - the app redraws whole, and a watcher or a refocus
  // can ask for one at any time. What is not allowed is the redraw putting
  // something on screen that was not there when the reader first looked.
  test("nothing turns up after it", async () => {
    // Long enough to cross a storage beat, so a quiet result means quiet
    // rather than unobserved.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    assert.equal(await page.eval('document.querySelector("#shell").innerText'), arrival);
  });

  test("nothing went wrong arriving", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("Reading a review the agent drafted", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
  });

  after(() => page.close());

  test("attaching storage puts the queue in the navbar", async () => {
    assert.equal(await page.text("#source-name"), "Work");
    assert.equal(await page.text("#queue-waiting"), "1 to review");
    assert.equal(await page.text("#queue-ready"), "1");
  });

  test("the drafted review opens by itself, and shows what the agent wrote", async () => {
    assert.equal(await page.text("#head-title"), "Re-root the errors onto a common base class");
    assert.match(await page.text("#blurb"), /the family catch-all is now inert/);
    assert.equal(await page.count("#tab-summary .finding"), 2);
  });

  test("the footer counts what would be sent, and what would block", async () => {
    assert.equal(await page.text("#staged"), "2 comments staged");
    assert.equal(await page.text("#counts"), "1 blocking · 1 note");
  });

  test("the two sends on the screen say which is which", async () => {
    assert.equal(await page.text("#post"), "Post review");
    assert.match(
      await page.text("#tab-summary .finding:first-of-type .finding-actions"),
      /Post this comment/,
    );
  });

  test("dropping a comment takes it out of what would be sent", async () => {
    await page.clickButton("#tab-summary .finding:first-of-type", "Drop");

    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the footer to drop a comment",
    );
    assert.equal(await page.text("#counts"), "0 blocking · 1 note");

    // Dropped, not deleted: what the agent said is still readable.
    assert.equal(await page.count("#tab-summary .finding.is-dropped"), 1);
    assert.match(await page.text("#tab-summary .finding.is-dropped"), /never matches/);
  });

  test("restoring it puts it back", async () => {
    await page.clickButton("#tab-summary .finding.is-dropped", "Restore");

    await page.until(
      'document.querySelector("#staged").textContent === "2 comments staged"',
      "the footer to take the comment back",
    );
    assert.equal(await page.count("#tab-summary .finding.is-dropped"), 0);
  });

  test("the verdict the reader chooses is the one the footer stands behind", async () => {
    await page.clickWhere(
      'document.querySelector("#verdicts button[data-event=REQUEST_CHANGES]")',
      "the request changes button",
    );

    await page.until(
      'document.querySelector("#verdicts button[data-event=REQUEST_CHANGES]").getAttribute("aria-pressed") === "true"',
      "the verdict to be taken",
    );
    assert.equal(await page.text("#consequence"), "blocks merge until resolved");
  });

  test("dismissing is not offered on somebody else's pull request", async () => {
    assert.equal(
      await page.eval('document.querySelector("#verdicts button[data-event=DISMISS]").hidden'),
      true,
    );
  });

  test("every decision survives the browser being closed", async () => {
    await page.clickButton("#tab-summary .finding:first-of-type", "Drop");
    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the drop to land",
    );

    await page.go();
    await drawn(page);
    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the reopened review to remember the drop",
    );

    assert.equal(await page.count("#tab-summary .finding.is-dropped"), 1);
    assert.equal(
      await page.eval(
        'document.querySelector("#verdicts button[data-event=REQUEST_CHANGES]").getAttribute("aria-pressed")',
      ),
      "true",
    );
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("Clearing a review that is open", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");
  });

  after(() => page.close());

  test("the pane stops showing a review that is no longer there", async () => {
    // Clearing a review is the draft file going away: the file is the record,
    // so removing it is the whole operation, and it happens somewhere else
    // entirely. Nothing here reaches into the app.
    await page.eval('globalThis.__world.objects.delete("drafts/org--app-42/review.json")');

    // The reader coming back to the tab, which is the moment this app asks
    // what is waiting and reads the drafts again.
    await page.eval('window.dispatchEvent(new Event("focus"))');

    await page.until(
      'document.querySelector("#tab-summary .empty-title")?.textContent === "No review has started."',
      "the pane to let the cleared review go",
    );

    assert.equal(await page.count("#tab-summary .finding"), 0);
  });

  test("the queue row resets to match, rather than keeping its marks", async () => {
    assert.equal(await page.text("#queue .state"), "not started");
    assert.equal(await page.count("#queue .bars span"), 0);
    assert.equal(await page.count("#queue .ready-dot"), 0);
    assert.equal(await page.text("#queue-count"), "0/1 drafted");
    assert.equal(await page.text("#queue-ready"), "");

    // The tally under the rows counts the same pull request, so it cannot
    // claim a review is under way when the row above it says none has started.
    assert.equal(await page.text("#queue-foot"), "0 drafted · 1 waiting");
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("Asking for the review again", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");
  });

  after(() => page.close());

  test("one click only asks, so a review cannot be lost to a stray tap", async () => {
    await page.click(".clear-review");

    assert.equal(await page.text(".clear-review"), "Delete?");
    assert.equal(
      await page.eval('globalThis.__world.objects.has("drafts/org--app-42/review.json")'),
      true,
    );
  });

  test("the second click takes the draft out of the storage itself", async () => {
    await page.click(".clear-review");

    await page.until(
      '!globalThis.__world.objects.has("drafts/org--app-42/review.json")',
      "the draft to be deleted from the storage",
    );
  });

  test("and the pull request goes back to waiting, where the agent will find it", async () => {
    await page.until(
      'document.querySelector("#tab-summary .empty-title")?.textContent === "No review has started."',
      "the pane to let the cleared review go",
    );

    assert.equal(await page.text("#queue .state"), "not started");
    assert.equal(await page.text("#queue-foot"), "0 drafted · 1 waiting");

    // Nothing left to throw away, so nothing offers to.
    assert.equal(await page.count(".clear-review"), 0);
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("Posting the review", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");
  });

  after(() => page.close());

  test("the sheet previews only what this send would do", async () => {
    await page.clickButton("#tab-summary .finding:first-of-type", "Drop");
    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the drop to land",
    );

    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");

    assert.equal(await page.text("#confirm-target"), "org/app#42");
    assert.equal(await page.text("#confirm-count"), "posts the summary and 1 line comment");
    assert.equal(await page.count("#confirm-preview .finding"), 1);
    assert.equal(await page.text("#confirm-note"), "nothing has been sent yet");
  });

  test("what leaves is exactly what was previewed", async () => {
    await page.click("#confirm-post");
    await page.until('!document.querySelector("#celebrate").hidden', "the review to land");

    const sent = await page.eval("globalThis.__world.sent");

    assert.equal(sent.length, 1);
    assert.equal(sent[0].what, "review");
    assert.equal(sent[0].body.event, "COMMENT");
    assert.equal(sent[0].body.body, "Two things worth a look before this goes in.");
    assert.deepEqual(
      sent[0].body.comments.map((comment) => comment.path),
      ["spec/error_spec.rb"],
    );
  });

  test("a posted review is recorded, and leaves the queue", async () => {
    assert.match(await page.text("#cheer-slug"), /org\/app#42/);

    await page.click("#cheer-close");
    await page.until(
      'document.querySelector("#queue-waiting").textContent === "nothing to review"',
      "the queue to let the posted review go",
    );

    assert.equal(await page.eval('document.querySelector("#post").disabled'), true);
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("Dismissing your own pull request", () => {
  // The case this exists for. GitHub refuses an approval or a change request
  // from the author, so the only verdict on offer is a comment, and here there
  // is nothing drafted to comment with. Without a way out, the pull request
  // sits on the queue for ever.
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      login: "reader",
      pulls: [aPull({ user: { login: "reader" } })],
      objects: {},
    });
    await attachStorage(page);

    // Nothing is drafted, so nothing opens by itself: the reader picks it off
    // the queue the way they would any pull request the agent has not reached.
    await page.click("#queue-button");
    await page.until('document.querySelector("#queue .row")', "the queue to list it");
    await page.click("#queue .row");
    await page.until(
      '!document.querySelector("#verdicts button[data-event=DISMISS]").hidden',
      "the pull request to open",
    );
  });

  after(() => page.close());

  test("only the verdict GitHub would take is offered, alongside dismissing", async () => {
    const offered = await page.eval(
      '[...document.querySelectorAll("#verdicts button")].filter((b) => !b.hidden).map((b) => b.dataset.event)',
    );

    assert.deepEqual(offered, ["COMMENT", "DISMISS"]);
  });

  test("there is nothing to post, because nothing was drafted", async () => {
    assert.equal(await page.text("#post"), "Post review");
    assert.equal(await page.eval('document.querySelector("#post").disabled'), true);
  });

  test("choosing dismiss says plainly that nothing will be sent", async () => {
    await page.clickWhere(
      'document.querySelector("#verdicts button[data-event=DISMISS]")',
      "the dismiss button",
    );

    await page.until(
      'document.querySelector("#verdicts button[data-event=DISMISS]").getAttribute("aria-pressed") === "true"',
      "dismissing to be taken",
    );

    assert.equal(await page.text("#consequence"), "sends nothing and takes it off your queue");

    // One send button, saying what it would actually do. An undrafted review
    // cannot be posted, but it can be dismissed.
    assert.equal(await page.text("#post"), "Dismiss");
    assert.equal(await page.eval('document.querySelector("#post").disabled'), false);
  });

  test("committing it takes the pull request off the queue, and sends nothing", async () => {
    await page.click("#post");

    await page.until(
      'document.querySelector("#queue-waiting").textContent === "nothing to review"',
      "the queue to let it go",
    );

    // No confirmation sheet, because there is nothing to confirm sending.
    assert.equal(await page.eval('document.querySelector("#confirm").hidden'), true);
    assert.deepEqual(await page.eval("globalThis.__world.sent"), []);
  });

  test("the dismissal outlives the browser being closed", async () => {
    await page.go();
    await drawn(page);
    await page.until(
      'document.querySelector("#source-name").textContent === "Work"',
      "the interface to come back",
    );

    assert.equal(await page.text("#queue-waiting"), "nothing to review");
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});
