// Everything a journey needs before it can begin.
//
// The fixtures deliberately echo test/use-cases/helper.js: the same draft, the
// same pull request. A unit test and an end to end test disagreeing about what
// a draft looks like would be two descriptions of one product.
//
// Nothing here is a credential. The bucket is a Map in the page and the
// destination is a function beside it, so the strings typed into the setup
// forms are the shape of a credential and none of the substance. That is the
// point: this suite has to run on every commit, unattended, and a suite that
// needed a real token would be a suite nobody could run.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { draftPath } from "../../web/src/domain/draft-path.js";

const here = dirname(fileURLToPath(import.meta.url));

const ENDPOINT = "https://storage.test.invalid";
const BUCKET = "reviews";

// What the reader would type into the setup forms. Fake, and shaped like the
// real thing so the forms are filled in the way a reader fills them.
const TYPED = {
  bucket: BUCKET,
  region: "us-east-1",
  endpoint: ENDPOINT,
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  token: "test-token",
};

/**
 * A draft as the agent would have written it.
 *
 * @param {object} [overrides] fields to change
 * @returns {object} a schema 3 draft
 */
export function aDraft(overrides = {}) {
  return {
    schema: 3,
    owner: "org",
    repo: "app",
    number: 42,
    title: "Re-root the errors onto a common base class",
    url: "https://github.com/org/app/pull/42",
    author: "someone",
    reviewedAt: "e612b1b",
    draftedAt: "2026-07-29T15:32:00Z",
    finishedAt: "2026-07-29T15:41:10Z",
    verdict: "COMMENT",
    summary: "Re-rooted correctly, but the family catch-all is now inert.",
    sections: [{ key: "correctness", label: "Correctness", color: "warn" }],
    findings: [
      {
        id: "inert-catch-all",
        section: "correctness",
        path: "lib/error.rb",
        line: 12,
        kind: "bug",
        color: "critical",
        blocking: true,
        body: "The rescue clause now parses and never matches.",
      },
      {
        id: "spec-cannot-fail",
        section: "correctness",
        path: "spec/error_spec.rb",
        line: 40,
        kind: "question",
        body: "This spec asserts nothing that could fail.",
      },
    ],
    comment: "Two things worth a look before this goes in.",
    ...overrides,
  };
}

/**
 * The ticket as the reporter wrote it, and the body the agent proposes instead.
 *
 * Shaped as a pair on purpose: the diff between them is exactly two hunks, the
 * title line and the tail, with the reporter's middle untouched - so a test can
 * reject one hunk and state the resulting body literally.
 *
 * @returns {string} the live body
 */
export function theIssueBody() {
  return [
    "export is broken, please fix today",
    "",
    "Steps:",
    "1. Open the orders page",
    '2. Click "Export CSV"',
    "3. Wait",
    "",
    "The spinner runs forever and nothing downloads.",
    "It worked before the last deploy.",
  ].join("\n");
}

/**
 * @returns {string} the proposed replacement body
 */
export function theProposedBody() {
  return [
    'Orders export: "Export CSV" spins forever and no file downloads',
    ...theIssueBody().split("\n").slice(1),
    "",
    "Expected: a CSV of the listed orders downloads.",
  ].join("\n");
}

/**
 * A triage draft as the agent would have written one: no verdict, a proposed
 * replacement body, and the comment that goes under the rewrite.
 *
 * @param {object} [overrides] fields to change
 * @returns {object} a schema 3 draft
 */
export function anIssueDraft(overrides = {}) {
  return {
    schema: 3,
    owner: "org",
    repo: "app",
    number: 7,
    title: "Export never finishes",
    url: "https://github.com/org/app/issues/7",
    author: "sofia",
    draftedAt: "2026-07-29T16:01:00Z",
    finishedAt: "2026-07-29T16:05:00Z",
    summary: "The report is real; the title and the tail bury it.",
    description: theProposedBody(),
    comment: "Retitled to the symptom and added the expected result. Your steps are untouched.",
    ...overrides,
  };
}

/**
 * An issue as the world serves its detail: what a GET of the ticket answers
 * beyond its live body. The queue never lists it - only its draft does that.
 *
 * @param {object} [overrides] fields to change
 * @returns {object} one issue
 */
export function anIssue(overrides = {}) {
  return {
    number: 7,
    title: "Export never finishes",
    html_url: "https://github.com/org/app/issues/7",
    ...overrides,
  };
}

/**
 * The changed files, with enough patch for the diff to draw.
 *
 * @returns {object[]} one entry per file
 */
export function theFiles() {
  return [
    {
      filename: "lib/error.rb",
      additions: 3,
      deletions: 1,
      patch: [
        "@@ -9,5 +9,7 @@ module App",
        "   class Error < StandardError",
        "-    def self.family",
        "+    def self.family(kind)",
        "+      raise ArgumentError unless kind",
        "+    end",
        "   end",
      ].join("\n"),
    },
    {
      filename: "spec/error_spec.rb",
      additions: 2,
      deletions: 0,
      patch: [
        "@@ -38,3 +38,5 @@ RSpec.describe App::Error do",
        "   it \"has a family\" do",
        "+    expect(described_class).to respond_to(:family)",
        "+  end",
      ].join("\n"),
    },
    {
      // A file the change only removes, which is the one a list that counts
      // additions alone has nothing to say about.
      filename: "lib/legacy_error.rb",
      additions: 0,
      deletions: 4,
      patch: [
        "@@ -1,4 +0,0 @@",
        "-module App",
        "-  class LegacyError < StandardError",
        "-  end",
        "-end",
      ].join("\n"),
    },
  ];
}

/**
 * Put a draft where the agent would have put it.
 *
 * @param {object} draft the draft
 * @returns {object} the object key mapped to its contents
 */
export function written(draft) {
  return { [draftPath(draft.owner, draft.repo, draft.number)]: JSON.stringify(draft, null, 2) };
}

/**
 * Open the interface, with a world behind it.
 *
 * The queue is whatever `world.objects` holds drafts for: an entry exists
 * because a draft file does, and every harness draft carries the url and
 * author the derivation reads. GitHub is only ever asked per item.
 *
 * @param {object} browser the browser
 * @param {string} origin where the interface is served
 * @param {object} [world] what the storage holds and what GitHub would say
 * @param {object} [world.objects] object key to contents
 * @param {object[]} [world.issues] each issue's detail beyond its body
 * @param {object} [world.issueBodies] each issue's live body, keyed "owner/repo#n"
 * @param {string} [world.login] who the token belongs to
 * @param {string} [world.postedUrl] what a send's response points back at
 * @returns {Promise<object>} the page, loaded and idle
 */
export async function openApp(browser, origin, world = {}) {
  const page = await browser.page(origin);

  const seed = {
    endpoint: ENDPOINT,
    bucket: BUCKET,
    login: world.login || "reader",
    postedUrl: world.postedUrl || "",
    issues: world.issues || [],
    issueBodies: world.issueBodies || {},
    headCommit: "e612b1b",
    files: theFiles(),
    objects: world.objects || written(aDraft()),
  };

  await page.inject(
    `globalThis.__seed = ${JSON.stringify(seed)};\n` +
      (await readFile(join(here, "world.js"), "utf8")),
  );

  await page.go();
  await drawn(page);

  return page;
}

/**
 * Wait for the interface to arrive.
 *
 * It arrives all at once, from behind a curtain, so the shell having been
 * parsed says nothing about whether there is yet anything to drive. Waiting on
 * a piece of that shell would hand back a page whose every click lands on the
 * curtain instead.
 *
 * @param {object} page the page
 * @returns {Promise<void>} when the curtain is down
 */
export async function drawn(page) {
  await page.until('document.querySelector("#curtain").hidden', "the interface to arrive");
}

/**
 * Attach a destination and a source, through the interface, the way a reader
 * arriving for the first time does.
 *
 * @param {object} page the page
 * @returns {Promise<void>} when a source is attached and its queue is in
 */
export async function attachStorage(page) {
  await page.click("#source-button");
  await page.until('!document.querySelector("#setup-popover").hidden', "the settings panel");

  // A fresh profile opens onto the teaching state; connecting GitHub is its
  // way into the destination form.
  await page.clickButton("#setup-popover", "Connect GitHub");
  await page.until('!document.querySelector("#destination-form").hidden', "the destination form");

  await page.fill('[data-focus-key="destination:label"]', "Work GitHub");
  await page.fill('[data-focus-key="destination:token"]', TYPED.token);
  await page.click("#destination-form button[type=submit]");
  await page.until(
    'document.querySelector("#destination-list .dir")?.textContent.includes("signed in as")',
    "the destination to say who it signed in as",
  );

  // With one half attached and the other still missing, the panel offers the
  // missing half next: the source add form is already open.
  await page.until('!document.querySelector("#source-form").hidden', "the source form");
  await page.choose("#source-form select", "s3");
  await page.fill('[data-focus-key="source:name"]', "Work");
  await page.fill('[data-focus-key="source:bucket"]', TYPED.bucket);
  await page.fill('[data-focus-key="source:region"]', TYPED.region);
  await page.fill('[data-focus-key="source:endpoint"]', TYPED.endpoint);
  await page.fill('[data-focus-key="source:accessKeyId"]', TYPED.accessKeyId);
  await page.fill('[data-focus-key="source:secretAccessKey"]', TYPED.secretAccessKey);
  await page.click("#source-form button[type=submit]");

  await page.until(
    'document.querySelector("#source-name").textContent === "Work"',
    "the source to be attached",
  );

  // The header names the new source part way through attaching it; the detail
  // settles on the saved source last, with the clean footer's Done. Waiting
  // for that button waits for the final redraw, so the click below cannot be
  // aimed at a button that moves out from under it.
  await page.until(
    '[...document.querySelectorAll("#source-form button")].some((b) => b.textContent.trim() === "Done")',
    "the saved source's detail to settle",
  );

  // Setup is finished with, so it is put away. Leaving it open would leave its
  // scrim over the review underneath, which is not what a reader would do.
  await page.clickButton("#source-form", "Done");
  await page.until('document.querySelector("#setup-popover").hidden', "setup to close");
}
