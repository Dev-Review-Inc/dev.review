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
import { aDraft, attachStorage, drawn, openApp, written } from "./support/harness.js";

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

  // The CORS-proxy caveat and the "full setup" doc link both describe one
  // specific backend, so showing them regardless of which one is chosen is
  // wrong in exactly the case that matters: a reader picking GitHub reading
  // a warning about git's browser proxy, right above GitHub's own fields.
  test("the hint and the doc link belong to whichever backend is chosen, not whichever one has a hint", async () => {
    // Left open by the test above, on the add-source form nothing attached
    // starts on.
    await page.choose("#source-form select", "git");
    await page.until(
      'document.querySelector("#source-form .settings-hint")?.textContent.includes("cors proxy")',
      "the git hint to show",
    );
    assert.match(
      await page.eval('document.querySelector("#source-form .settings-doc-link")?.href || ""'),
      /\/adapters\/git$/,
    );

    await page.choose("#source-form select", "s3");
    await page.until(
      '!document.querySelector("#source-form .settings-hint")',
      "the git hint to go with the git backend it described",
    );
    assert.match(
      await page.eval('document.querySelector("#source-form .settings-doc-link")?.href || ""'),
      /\/adapters\/s3$/,
    );
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
    assert.equal(await page.text("#staged"), "0 comments staged");

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
    assert.equal(await page.text("#staged"), "0 comments staged");
    assert.equal(await page.text("#counts"), "0 blocking · 0 notes");
  });

  test("the two sends on the screen say which is which", async () => {
    assert.equal(await page.text("#post"), "Comment");
    assert.match(
      await page.text("#tab-summary .finding:first-of-type .finding-actions"),
      /Post this comment/,
    );
  });

  test("including a comment puts it in what would be sent", async () => {
    await page.clickButton("#tab-summary .finding:first-of-type", "Include");

    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the footer to include a comment",
    );
    assert.equal(await page.text("#counts"), "1 blocking · 0 notes");

    // Included, not copied: what the agent said is the one thing being sent.
    assert.equal(await page.count("#tab-summary .finding:first-of-type.is-included"), 1);
    assert.match(await page.text("#tab-summary .finding:first-of-type"), /never matches/);
  });

  test("excluding it takes it back out", async () => {
    await page.clickButton("#tab-summary .finding:first-of-type", "Include");

    await page.until(
      'document.querySelector("#staged").textContent === "0 comments staged"',
      "the footer to take the comment back out",
    );
    assert.equal(await page.count("#tab-summary .finding:first-of-type.is-included"), 0);
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
    assert.equal(await page.text("#post"), "Request changes");
  });

  // It used to slide up as a sheet from the bottom edge of the screen, which
  // read as a different control entirely from the button that opened it. It
  // has to look like it came out of that button: right-aligned to it and
  // sitting just above it, not centred under the whole viewport.
  test("the verdict choices open where the caret is, not centred on the screen", async () => {
    await page.clickWhere('document.querySelector("#verdict-button")', "the verdict button");
    await page.until('!document.querySelector("#verdict-popover").hidden', "the verdict sheet");

    const gap = await page.eval(`(() => {
      const anchor = document.querySelector("#verdict-button").getBoundingClientRect();
      const sheet = document.querySelector("#verdict-popover").getBoundingClientRect();

      return JSON.stringify({
        rightEdges: Math.round(Math.abs(sheet.right - anchor.right)),
        above: Math.round(anchor.top - sheet.bottom),
        centred: Math.round(sheet.width) === Math.round(document.querySelector("#shell").clientWidth) ||
          Math.round(sheet.left) === 0,
      });
    })()`);
    const { rightEdges, above, centred } = JSON.parse(gap);

    assert.ok(rightEdges <= 4, `the sheet's right edge sits ${rightEdges}px from the caret's`);
    assert.ok(above >= 0 && above <= 16, `the sheet sits ${above}px above the caret`);
    assert.equal(centred, false, "the sheet reads as a centred bottom sheet");

    await page.clickWhere('document.querySelector("#verdict-backdrop")', "the backdrop");
  });

  test("dismissing is offered on somebody else's pull request too", async () => {
    assert.equal(
      await page.eval('document.querySelector("#verdict-popover button[data-event=DISMISS]").hidden'),
      false,
    );
  });

  test("every decision survives the browser being closed", async () => {
    await page.clickButton("#tab-summary .finding:first-of-type", "Include");
    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the include to land",
    );

    await page.go();
    await drawn(page);
    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the reopened review to remember it",
    );

    assert.equal(await page.count("#tab-summary .finding:first-of-type.is-included"), 1);
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
    await page.clickButton("#tab-summary .finding:first-of-type", "Include");

    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the include to land on the same click that closed the editor",
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

  test("the queue lets it go entirely, because nothing appears without a draft", async () => {
    // The draft was the entry: the queue is derived from the drafts and from
    // nothing else, so a cleared draft is not a row reset to "not started" -
    // it is no row at all, until the sweep writes a fresh one.
    assert.equal(await page.text("#queue-waiting"), "nothing to review");
    assert.equal(await page.count("#queue .row"), 0);
    assert.equal(await page.text("#queue-count"), "0/0 drafted");
    assert.equal(await page.text("#queue-ready"), "");
    assert.match(await page.text("#queue-foot"), /No drafts in this source yet/);
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

  test("and the pull request leaves the queue, until the agent drafts it again", async () => {
    await page.until(
      'document.querySelector("#tab-summary .empty-title")?.textContent === "No review has started."',
      "the pane to let the cleared review go",
    );

    // The queue is the drafts, so asking for the review again is handing the
    // pull request back to the agent entirely: no draft, no row.
    assert.equal(await page.text("#queue-waiting"), "nothing to review");
    assert.match(await page.text("#queue-foot"), /No drafts in this source yet/);

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
    await page.clickButton("#tab-summary .finding:first-of-type", "Include");
    await page.until(
      'document.querySelector("#staged").textContent === "1 comment staged"',
      "the include to land",
    );

    await page.clickButton("#tab-summary .summary-actions", "Include");
    await page.until(
      'document.querySelector(".summary-box.is-included")',
      "the summary include to land",
    );

    await page.click("#post");
    await page.until('!document.querySelector("#confirm").hidden', "the confirmation sheet");

    assert.equal(await page.text("#confirm-target"), "org/app#42");
    assert.equal(await page.text("#confirm-count"), "posts the summary and 1 line comment");
    assert.equal(await page.count("#confirm-preview .finding"), 1);
    assert.equal(await page.text("#confirm-note"), "nothing has been sent yet");
  });

  // The sheet is the last look at the review, which is exactly where a
  // reader notices the sentence they want to change. Sending them back to
  // the page to fix it and then asking them to open the sheet again is a
  // round trip for something they are already looking at.
  test("the summary can still be written in, from the sheet itself", async () => {
    await page.clickWhere('document.querySelector("#confirm-preview .summary-box")', "the summary");
    await page.until(
      'document.querySelector("#confirm-preview textarea")',
      "the summary to open for writing",
    );

    await page.fill("#confirm-preview textarea", " Read the second one first.");
    await page.clickWhere('document.querySelector("#confirm-count")', "the sheet, away from the box");

    await page.until(
      'document.querySelector("#confirm-preview .summary-box")',
      "the summary to go back to being read",
    );
    assert.match(await page.text("#confirm-preview"), /Read the second one first\./);

    // The sheet redraws under the cursor when the box gives its edit up, and
    // the release that follows must not read as a click on the backdrop.
    assert.equal(await page.eval('document.querySelector("#confirm").hidden'), false);
  });

  test("what leaves is exactly what was previewed", async () => {
    await page.click("#confirm-post");
    await page.until('!document.querySelector("#celebrate").hidden', "the review to land");

    const sent = await page.eval("globalThis.__world.sent");

    assert.equal(sent.length, 1);
    assert.equal(sent[0].what, "review");
    assert.equal(sent[0].body.event, "COMMENT");
    assert.equal(
      sent[0].body.body,
      "Two things worth a look before this goes in. Read the second one first.",
    );
    assert.deepEqual(
      sent[0].body.comments.map((comment) => comment.path),
      ["lib/error.rb"],
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
  // The queue derivation reads the url's shape, not its scheme: it wants a
  // "/pull/N" in there, and a hostile draft can carry one. So a draft like
  // this still reaches the screen, and the scheme guard in the view is the
  // one thing between its url and a click.
  const HOSTILE = "javascript:globalThis.__stolen = true;//pull/42";

  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      objects: written(aDraft({ url: HOSTILE })),
      postedUrl: HOSTILE,
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
    await page.clickButton("#tab-summary .summary-actions", "Include");
    await page.until('document.querySelector(".summary-box.is-included")', "the summary to go in");

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
  // from the author, so the only verdict on offer is a comment, and nothing
  // here has been opted into one. Without a way out, the pull request sits on
  // the queue for ever. The queue is the drafts, so the reader's own pull
  // request is on it the same way anything is: the agent started a draft -
  // this one still being written, which is also why nothing opens by itself.
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, {
      login: "reader",
      objects: written(aDraft({ author: "reader", finishedAt: undefined })),
    });
    await attachStorage(page);

    // An unfinished draft never opens by itself: the reader picks it off the
    // queue the way they would any review still being written.
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

  test("there is nothing to post, because nothing has been opted in", async () => {
    assert.equal(await page.text("#post"), "Comment");
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

  // Dismissing answers "I am not reviewing this", not "I never want to see
  // it again". The only thing the list offered was putting it back on the
  // queue, which is a heavier answer than a reader who just wants another
  // look is asking for.
  test("a dismissed pull request can still be opened, without coming back", async () => {
    await page.click("#cheer-close");
    await page.click("#queue-button");
    await page.until('document.querySelector("#dismissed .setup-row")', "the dismissed list");

    await page.click("#dismissed .setup-row");

    await page.until(
      'document.querySelector("#head-title").textContent !== ""',
      "the dismissed pull request to open",
    );
    assert.equal(await page.text("#queue-waiting"), "nothing to review");
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
  // Posting a review takes the pull request off the queue, and the sweep
  // pruning the handled draft then drafting it again must not put it back:
  // another look at a posted review is the reader's own gesture, in the app.
  let page;

  before(async () => {
    page = await openApp(browser, site.origin, { objects: written(aDraft()) });
    await attachStorage(page);
    await page.until('document.querySelector("#tab-summary .finding")', "the review to open");

    await page.clickButton("#tab-summary .summary-actions", "Include");
    await page.until('document.querySelector(".summary-box.is-included")', "the summary to go in");

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
    // The reader coming back to the tab, which is the moment this app reads
    // the drafts again. The draft is still there, unchanged: the posted
    // review answered it, and it must not come back on that draft's account.
    await page.eval('window.dispatchEvent(new Event("focus"))');

    assert.equal(await page.text("#queue-waiting"), "nothing to review");
    assert.equal(await page.eval('document.querySelector("#dismissed").hidden'), false);
  });

  test("a redraft after the review does not put it back on the queue", async () => {
    // The sweep drafting again - even a newer draft - is not a new question
    // once the review is posted. The renamed title proves the redraft was
    // read; the queue staying empty proves it revived nothing.
    await page.eval(`(() => {
      const draft = ${JSON.stringify(aDraft())};

      draft.title = "Re-root the errors, take two";
      draft.draftedAt = new Date().toISOString();
      globalThis.__world.put("drafts/org--app-42/review.json", JSON.stringify(draft));
    })()`);
    await page.eval('window.dispatchEvent(new Event("focus"))');

    await page.until(
      'document.querySelector("#dismissed .setup-row .name")?.textContent === "Re-root the errors, take two"',
      "the redraft to be read",
    );

    assert.equal(await page.text("#queue-waiting"), "nothing to review");
    assert.equal(await page.eval('document.querySelector("#dismissed").hidden'), false);
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

  // The caret is not a second button standing next to the send button, it is
  // the same button's other half: one fill, no seam between them, and the
  // divider that tells them apart is drawn short of the edges so the pair
  // still reads as one shape.
  test("the send button and its caret read as one control", async () => {
    const found = await page.eval(`(() => {
      const post = document.querySelector("#post");
      const caret = document.querySelector("#verdict-button");
      const one = post.getBoundingClientRect();
      const two = caret.getBoundingClientRect();

      return JSON.stringify({
        fills: [getComputedStyle(post).backgroundColor, getComputedStyle(caret).backgroundColor],
        gap: Math.round(two.left - one.right),
        divider: getComputedStyle(caret).backgroundSize,
        outer: getComputedStyle(document.querySelector(".split")).borderRadius,
      });
    })()`);

    const { fills, gap, divider, outer } = JSON.parse(found);

    assert.equal(fills[0], fills[1], "the two halves are painted differently");
    assert.equal(gap, 0, "there is a seam between the two halves");
    assert.match(divider, /^1px \d/, `the divider runs the whole height: ${divider}`);
    assert.match(outer, /^6px$/, `the pair is not one rounded shape: ${outer}`);
  });

  test("a finding's actions stand the same height as each other", async () => {
    // The include toggle is not a .ui-button - a different visual language on
    // purpose, a box and a label rather than a filled control - but it sits
    // in the same row as Edit and Post and has to stand the same height
    // they do, so it is measured alongside them here rather than with them.
    const heights = await measure(
      "#tab-summary .finding:first-of-type .ui-button, #tab-summary .finding:first-of-type .finding-include",
    );

    assert.ok(heights.length >= 3, `only ${heights.length} buttons`);
    assert.deepEqual([...new Set(heights)], [36]);
  });

  test("the confirm sheet's way out and its send stand the same height", async () => {
    // Nothing has been opted in on this page yet, and the send button is
    // rightly dead until something is.
    await page.clickButton("#tab-summary .summary-actions", "Include");
    await page.until('document.querySelector(".summary-box.is-included")', "the summary to go in");

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
