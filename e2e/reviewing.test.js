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

  // Sign out used to carry a label wide enough that, beside a long title, it
  // wrapped clear off the header's own row. An icon has no such width to give
  // back, and still needs to say who it is to someone who cannot see it.
  test("sign out is an icon, not a label, and still has a name to a screen reader", async () => {
    assert.equal(await page.text("#signout"), "");
    assert.equal(await page.count("#signout svg"), 1);
    assert.equal(await page.eval('document.querySelector("#signout").getAttribute("aria-label")'), "Sign out");
    assert.equal(await page.eval('document.querySelector("#signout").title'), "Forget this destination's token and sign in again");
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
    await page.clickWhere('document.querySelector("#verdict-button")', "the verdict button");
    await page.clickWhere(
      'document.querySelector("#verdict-popover button[data-event=REQUEST_CHANGES]")',
      "the request changes choice",
    );

    await page.until(
      'document.querySelector("#verdict-popover button[data-event=REQUEST_CHANGES]").getAttribute("aria-pressed") === "true"',
      "the verdict to be taken",
    );
    assert.equal(await page.text("#consequence"), "blocks merge until resolved");
  });

  test("dismissing is offered on somebody else's pull request too", async () => {
    assert.equal(
      await page.eval('document.querySelector("#verdict-popover button[data-event=DISMISS]").hidden'),
      false,
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
        'document.querySelector("#verdict-popover button[data-event=REQUEST_CHANGES]").getAttribute("aria-pressed")',
      ),
      "true",
    );
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("Sizing the changed files from the list", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#files .file")', "the files to be listed");
  });

  after(() => page.close());

  test("every row says what came out as well as what went in", async () => {
    assert.deepEqual(
      await page.eval(`[...document.querySelectorAll("#files .file")].map((row) => [
        row.querySelector(".path").textContent,
        row.querySelector(".adds")?.textContent || "",
        row.querySelector(".dels")?.textContent || "",
      ])`),
      [
        ["lib/error.rb", "+3", "−1"],
        ["spec/error_spec.rb", "+2", "−0"],
        // The motivating case: a row reading "+0" alone cannot tell a reader
        // whether nothing happened or the whole file went.
        ["lib/legacy_error.rb", "+0", "−4"],
      ],
    );
  });

  test("a deletion count reads the same in the list as it does over the diff", async () => {
    const seen = await page.eval(`(() => {
      const style = (selector) => {
        const computed = getComputedStyle(document.querySelector(selector));
        return { color: computed.color, size: computed.fontSize };
      };
      return {
        listDels: style("#files .file .dels"),
        headDels: style("#diff .diff-head .dels"),
        listAdds: style("#files .file .adds"),
      };
    })()`);

    assert.equal(seen.listDels.color, seen.headDels.color);
    assert.equal(seen.listDels.size, seen.listAdds.size);
  });

  test("the findings badge still sits at the end of the row it belongs to", async () => {
    assert.deepEqual(
      await page.eval(
        '[...document.querySelector("#files .file").children].map((el) => el.className)',
      ),
      ["path", "spacer", "adds", "dels", "n is-critical"],
    );
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("Writing the review's summary", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");
  });

  after(() => page.close());

  test("the summary reads first, above the comments it introduces", async () => {
    assert.deepEqual(
      await page.eval('[...document.querySelector("#tab-summary").children].map((el) => el.id)'),
      ["comment-notes", "comment-body", "editor", "comment-cards", "comment-extra"],
    );
    assert.match(await page.text("#comment-body"), /Two things worth a look/);
  });

  test("a written summary still says it can be changed, quietly", async () => {
    // No button names the affordance, but nor should the box be silent about
    // it: the title carries it for a screen reader, and this carries it for
    // an eye that has not read the title yet.
    const hint = "#comment-body .summary-box .summary-edit-hint";

    assert.equal(await page.count(hint), 1);
    assert.equal(await page.text(hint), "click to edit");
    assert.equal(await page.eval(`document.querySelector("${hint}").getAttribute("aria-hidden")`), "true");
    assert.equal(
      await page.eval('document.querySelector("#comment-body .summary-box").title'),
      "Click to write in the summary",
    );
  });

  test("the summary is a box you click to write in, and no button says so", async () => {
    assert.equal(await page.count("#tab-summary button#edit"), 0);

    await page.click("#comment-body .summary-box");
    await page.until('!document.querySelector("#editor").hidden', "the editor to open");

    assert.equal(await page.eval("document.activeElement.id"), "editor");
    assert.equal(
      await page.eval('document.querySelector("#editor").value'),
      "Two things worth a look before this goes in.",
    );
  });

  test("clicking away keeps what was written, with nothing to save", async () => {
    await page.fill("#editor", " Read the second one twice.");
    await page.click("#blurb");

    await page.until('document.querySelector("#editor").hidden', "the editor to close");

    assert.match(await page.text("#comment-body"), /Read the second one twice\./);
    assert.equal(
      await page.eval("globalThis.__world.sent.length"),
      0,
      "editing must not send anything",
    );
  });

  test("one click both keeps the writing and does what it was aimed at", async () => {
    await page.click("#comment-body .summary-box");
    await page.until('!document.querySelector("#editor").hidden', "the editor to open");
    await page.fill("#editor", " And the first one is the worse.");

    // The click that closes the editor is a click on something: it has to
    // arrive, rather than being spent on closing the box.
    await page.clickButton("#tab-summary .finding:first-of-type", "Drop");

    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the drop to land on the same click that closed the editor",
    );
    assert.match(await page.text("#comment-body"), /And the first one is the worse\./);
  });

  test("the writing survives the browser being closed", async () => {
    await page.go();
    await page.until(
      'document.querySelector("#comment-body .summary-box")',
      "the reopened review to draw its summary",
    );

    assert.match(await page.text("#comment-body"), /Read the second one twice\./);
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

  test("the rail says the same thing the pane does, rather than nothing", async () => {
    assert.equal(await page.text("#analysis .rail-waiting"), "not started");
  });

  test("the rail's Summary row still stands and still opens the pane, even with nothing drafted yet", async () => {
    // On mobile this row is the only way out of an otherwise-empty drawer
    // before a draft exists - a reader with no clickable row in it has no
    // way to see the "not started" state this same rail already names.
    assert.equal(await page.count("#analysis .lens"), 1);
    assert.equal(await page.text("#analysis .lens .name"), "Summary");

    // clickButton matches a button's exact text, and this one's real text is
    // "☰Summary" - the tone glyph runs straight into the label with no space
    // between them in the markup. The row is the only one here either way,
    // so a plain selector says the same thing without repeating that detail.
    await page.click("#analysis .lens");

    await page.until(
      'document.querySelector("#analysis .lens")?.getAttribute("aria-pressed") === "true"',
      "the Summary row to take the click",
    );
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

// A draft is a file an agent wrote while reading somebody else's branch, and
// the pull request link is the most ordinary thing on the screen to click. A
// browser runs a `javascript:` href as code on the origin it is clicked from,
// and that origin holds the reader's GitHub token and their storage keys, so
// the scheme in a draft's url decides whether both are still theirs.
describe("A draft whose url is not a web address", () => {
  const HOSTILE = "javascript:globalThis.__stolen = true";

  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      objects: written(aDraft({ url: HOSTILE })),
      pulls: [aPull({ html_url: HOSTILE })],
    });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");
  });

  after(() => page.close());

  test("no link on the screen carries it", async () => {
    const hrefs = await page.eval(
      '[...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"))',
    );

    assert.deepEqual(
      hrefs.filter((href) => !/^https?:\/\//i.test(href)),
      [],
    );
  });

  test("the pull request is still named, as plain words rather than a link", async () => {
    assert.equal(await page.count("#blurb a"), 0);
    assert.match(await page.text("#blurb"), /app#42/);
  });

  test("nothing offers to copy a url the reader cannot use", async () => {
    assert.equal(await page.count("#blurb .copy-url"), 0);
  });

  test("the record of a posted review stands without a link to it", async () => {
    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");
    await page.click("#confirm-post");
    await page.until('!document.querySelector("#celebrate").hidden', "the review to land");

    assert.match(await page.text("#comment-notes"), /✓/);
    assert.equal(await page.count("#comment-notes a"), 0);
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
      '!document.querySelector("#verdict-popover button[data-event=DISMISS]").hidden',
      "the pull request to open",
    );
  });

  after(() => page.close());

  test("only the verdict GitHub would take is offered, alongside dismissing", async () => {
    const offered = await page.eval(
      '[...document.querySelectorAll("#verdict-popover button")].filter((b) => !b.hidden).map((b) => b.dataset.event)',
    );

    assert.deepEqual(offered, ["COMMENT", "DISMISS"]);
  });

  test("there is nothing to post, because nothing was drafted", async () => {
    assert.equal(await page.text("#post"), "Post review");
    assert.equal(await page.eval('document.querySelector("#post").disabled'), true);
  });

  test("choosing dismiss says plainly that nothing will be sent", async () => {
    await page.clickWhere('document.querySelector("#verdict-button")', "the verdict button");
    await page.clickWhere(
      'document.querySelector("#verdict-popover button[data-event=DISMISS]")',
      "the dismiss choice",
    );

    await page.until(
      'document.querySelector("#verdict-popover button[data-event=DISMISS]").getAttribute("aria-pressed") === "true"',
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

// A long review is read by scrolling, and every row in the rail is a different
// thing to read. Landing part way down the new one, wherever the last one
// happened to be left, is the reader's place being kept where they never put it.
describe("Moving between lenses in a long review", () => {
  let page;

  // Enough findings, in two sections, that the pane is taller than the window
  // and there is a second lens to move to.
  const tall = aDraft({
    sections: [
      { key: "correctness", label: "Correctness", color: "warn" },
      { key: "ux", label: "UX & visual", color: "neutral" },
    ],
    findings: Array.from({ length: 14 }, (_, index) => ({
      id: `finding-${index}`,
      section: index % 2 ? "ux" : "correctness",
      path: "lib/error.rb",
      line: index + 1,
      kind: "bug",
      body: `Something worth saying about line ${index + 1}, at enough length to fill a card.`,
    })),
  });

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(tall) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");
  });

  after(() => page.close());

  test("the reader can scroll the review, which is what the rest of this is about", async () => {
    await page.eval('document.querySelector("#comment").scrollTop = 800');

    assert.equal(await page.eval('document.querySelector("#comment").scrollTop'), 800);
  });

  test("opening another lens starts it at the top", async () => {
    await page.clickWhere(
      '[...document.querySelectorAll("#analysis .lens")].find((lens) => lens.querySelector(".name").textContent === "UX & visual")',
      "the UX & visual lens",
    );

    await page.until(
      '[...document.querySelectorAll("#analysis .lens")].find((lens) => lens.querySelector(".name").textContent === "UX & visual").getAttribute("aria-pressed") === "true"',
      "the UX lens to open",
    );

    assert.equal(await page.eval('document.querySelector("#comment").scrollTop'), 0);
  });

  test("a redraw that leaves the lens alone keeps the reader's place", async () => {
    await page.eval('document.querySelector("#comment").scrollTop = 400');
    assert.equal(await page.eval('document.querySelector("#comment").scrollTop'), 400);

    // A redraw of the same view, asked for from the rail rather than from the
    // pane, so nothing scrolls the pane on the way.
    await page.click("#files-flagged");
    await page.until(
      'document.querySelectorAll("#files .file").length === 1',
      "the file list to trim to what is flagged",
    );

    assert.equal(await page.eval('document.querySelector("#comment").scrollTop'), 400);
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

describe("A review request that comes back", () => {
  // Posting a review takes the pull request off the queue, so a reader's
  // dismissed list is everything they have ever reviewed. Someone asking for
  // another look has to be able to get through that.
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");

    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");
    await page.click("#confirm-post");
    await page.until('!document.querySelector("#celebrate").hidden', "the review to land");
    await page.click("#cheer-close");
    await page.until(
      'document.querySelector("#queue-waiting").textContent === "nothing to review"',
      "the queue to let the posted review go",
    );
  });

  after(() => page.close());

  test("what was reviewed stays gone while nothing new has happened to it", async () => {
    // The reader coming back to the tab, which is when this app asks GitHub
    // what is waiting.
    await page.eval('window.dispatchEvent(new Event("focus"))');

    assert.equal(await page.text("#queue-waiting"), "nothing to review");
    assert.equal(await page.eval('document.querySelector("#dismissed").hidden'), false);
  });

  test("a push after the review puts it back on the queue", async () => {
    // GitHub still has the review requested of the reader, and now the branch
    // has moved: a re-request, as this app can see one.
    await page.eval("globalThis.__seed.pulls[0].updated_at = new Date().toISOString()");
    await page.eval('window.dispatchEvent(new Event("focus"))');

    await page.until(
      'document.querySelector("#queue-waiting").textContent === "1 to review"',
      "the re-request to reach the queue",
    );

    assert.equal(await page.eval('document.querySelector("#dismissed").hidden'), true);
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

// A failure raised inside the settings panel used to be reported into the
// footer, which the panel's own scrim covers. The reader asked for storage to
// be attached, was told why it could not be, and never saw it: the words were
// behind the thing they were looking at. This drives that exact moment and
// asks the browser what is actually painted where.
describe("Being told why the storage would not attach", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);

    await page.click("#source-button");
    await page.until('!document.querySelector("#setup-popover").hidden', "the settings panel");
    await page.click("#settings-add");
    await page.until('!document.querySelector("#source-form").hidden', "the source form");

    await page.choose("#source-form select", "s3");
    await page.fill('[data-focus-key="source:name"]', "Nowhere");
    await page.fill('[data-focus-key="source:bucket"]', "reviews");
    await page.fill('[data-focus-key="source:region"]', "us-east-1");

    // An endpoint the world refuses, which is a bucket that cannot be reached
    // rather than a form filled in wrongly.
    await page.fill('[data-focus-key="source:endpoint"]', "https://gone.test.invalid");
    await page.fill('[data-focus-key="source:accessKeyId"]', "test-access-key");
    await page.fill('[data-focus-key="source:secretAccessKey"]', "test-secret-key");
    await page.click("#source-form button[type=submit]");

    await page.until(
      'document.querySelector("#status").textContent !== ""',
      "the interface to say what went wrong",
    );
  });

  after(() => page.close());

  test("the panel says the same thing the footer does", async () => {
    const said = await page.text("#status");

    assert.notEqual(said, "");
    assert.notEqual(said, "undefined");
    assert.equal(await page.text("#setup-say"), said);
  });

  test("the overlays that were not up carry none of it", async () => {
    // Otherwise the confirmation sheet would open later, about something else
    // entirely, wearing this failure across the top of it.
    assert.equal(await page.text("#confirm-say"), "");
    assert.equal(await page.text("#celebrate-say"), "");
  });

  test("the panel is still open, so the footer is the covered place", async () => {
    assert.equal(await page.eval('document.querySelector("#setup-popover").hidden'), false);

    // What the browser paints at the middle of the footer's report. Not the
    // report: the settings panel's scrim, which is the whole bug.
    assert.equal(await page.eval(painted("#status")), "setup-backdrop");
  });

  test("the panel's report is what the reader's eye actually lands on", async () => {
    assert.equal(await page.eval(painted("#setup-say")), "setup-say");
  });

  test("nothing went wrong along the way", () => {
    assert.deepEqual(page.complaints, []);
  });
});

// The stylesheet carried the sentence "every button shares one height" above a
// rule that set eight of them. Prose beside code does not hold. This is that
// sentence in the only place it can actually be checked: a real browser, with
// the real fonts, measuring what a reader would see.
describe("One height for every button", () => {
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");
  });

  after(() => page.close());

  test("the footer's send button and its verdict chip stand the same height", async () => {
    // #post was 38 and the verdicts 34, either side of the 36 everything else
    // on the row was: two pixels each way, which reads as a row that slipped.
    assert.deepEqual(await measure("#post, #verdict-button"), [36, 36]);
  });

  test("a finding's actions stand the same height as each other", async () => {
    const heights = await measure("#tab-summary .finding:first-of-type .ui-button");

    assert.ok(heights.length >= 3, `only ${heights.length} buttons`);
    assert.deepEqual([...new Set(heights)], [36]);
  });

  test("the confirm sheet's way out and its send stand the same height", async () => {
    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");

    // Keep editing was 36 and Post to GitHub was 32, side by side.
    assert.deepEqual(await measure("#confirm-cancel, #confirm-post"), [36, 36]);
    await page.click("#confirm-cancel");
  });

  test("the settings panel's buttons stand the same height as each other", async () => {
    await page.click("#source-button");
    await page.until('!document.querySelector("#setup-popover").hidden', "the settings panel");

    const heights = await measure("#setup-popover .ui-button");

    assert.ok(heights.length >= 2, `only ${heights.length} buttons`);
    assert.deepEqual([...new Set(heights)], [30]);
  });

  test("and no button anywhere is a height of its own", async () => {
    const heights = await measure(".ui-button");

    assert.ok(heights.length >= 10, `only ${heights.length} buttons`);

    for (const height of heights) {
      assert.ok([20, 30, 36].includes(height), `a button is ${height}px`);
    }
  });

  test("nothing went wrong while it was measured", () => {
    assert.deepEqual(page.complaints, []);
  });

  // Rounded, because a font metric can leave a box a hundredth of a pixel off
  // the height it was set to, and a hundredth is not a design decision.
  // Anything the reader cannot see is not on screen to have a height.
  function measure(selector) {
    return page.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})]
      .map((node) => Math.round(node.getBoundingClientRect().height))
      .filter((height) => height > 0)`);
  }
});

/**
 * An expression answering with the id of whatever is painted over an element.
 *
 * Computed styles would say the report is there and coloured; only asking what
 * is topmost at the point it occupies says whether it can be read.
 *
 * @param {string} selector the element to look through
 * @returns {string} javascript answering with an id, or "" for an unnamed hit
 */
function painted(selector) {
  return `(() => {
    const node = document.querySelector("${selector}");
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

    if (!hit) return "nothing";

    return (node.contains(hit) ? node : hit).id;
  })()`;
}
