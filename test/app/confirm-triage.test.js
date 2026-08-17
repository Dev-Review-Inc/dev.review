// Sending a triage: the sheet, the send, and the guard on the rewrite.
//
// A description rewrite replaces the whole body, so it is the one send in this
// app that can destroy words someone else just wrote. The guard is a re-fetch
// at the last moment: a ticket that moved since the reader read it is re-read,
// never overwritten, and the reader looks again at a diff against what is
// actually there. And nothing is recorded until everything staged has landed,
// because re-patching the same body is idempotent and a safe retry beats a
// queue that lies.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { openConfirm, post } from "../../web/src/app/confirm.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, aPull, agentWrites, theApp } from "../use-cases/helper.js";

const LIVE = "One.\nTwo.\nThree.";
const PROPOSED = "One.\nTwo, sharper.\nThree.";

// The smallest document the sheet touches: elements by id, built by tag,
// carrying text, children, styles and attributes. A real DOM would prove no
// more here and would mean a dependency in a project that has none.
function stub(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    disabled: false,
    children: [],
    dataset: {},
    style: { cssText: "", setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector() {
      return null;
    },
  };
}

function fakeDocument() {
  const byId = new Map();

  return {
    createElement: (tag) => stub(tag),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stub());

      return byId.get(id);
    },
  };
}

const anIssueDraft = (overrides = {}) =>
  aDraft({
    verdict: "",
    summary: "",
    sections: [],
    findings: [],
    description: PROPOSED,
    comment: "Why the body should change.",
    ...overrides,
  });

describe("triaging an issue through the sheet", () => {
  let app;
  let doc;
  let liveBody;
  let patched;
  let commented;
  let closed;
  let sequence;
  let refuseComment;
  let refuseClose;

  async function build(draft = anIssueDraft()) {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, draft);

    liveBody = LIVE;
    patched = [];
    commented = [];
    closed = [];
    sequence = [];
    refuseComment = false;
    refuseClose = false;

    app = await theApp({
      adapter,
      pulls: [aPull({ isIssue: true })],
      destination: {
        issue: async () => ({
          body: liveBody,
          title: "T",
          isPull: false,
          url: "https://github.com/org/app/issues/42",
        }),
        patchDescription: async (target, body) => {
          patched.push(body);
          sequence.push("patch");

          return { url: "https://x/issue" };
        },
        commentOnIssue: async (target, body) => {
          if (refuseComment) throw new Error("the destination refused");

          commented.push(body);
          sequence.push("comment");

          return { url: "https://x/comment" };
        },
        closeIssue: async (target, reason) => {
          if (refuseClose) throw new Error("the destination would not close it");

          closed.push(reason);
          sequence.push("close");

          return { url: "https://x/closed" };
        },
      },
    });

    await app.select(app.queue()[0]);

    doc = fakeDocument();
    globalThis.document = doc;
  }

  beforeEach(() => build());

  afterEach(() => {
    delete globalThis.document;
  });

  test("the sheet reads as a triage, not a verdict", () => {
    openConfirm(app);

    assert.equal(doc.getElementById("confirm-verdict").hidden, true);
    assert.equal(doc.getElementById("confirm-target").textContent, "org/app#42");
    assert.match(doc.getElementById("confirm-count").textContent, /1 of 1 changes kept/);
    assert.match(doc.getElementById("confirm-preview").innerHTML, /Why the body should change/);
  });

  test("posting patches the description, comments, and records the deeper link", async () => {
    await post(app);

    assert.deepEqual(patched, [PROPOSED]);
    assert.deepEqual(commented, ["Why the body should change."]);
    assert.equal(app.queries.isPosted(app.source, app.selected), true);
    assert.equal(app.selected.postedUrl, "https://x/comment");
    assert.equal(doc.getElementById("confirm").hidden, true);
  });

  test("a ticket that moved underneath the reader is re-read, never overwritten", async () => {
    liveBody = "Someone else's words.";

    await post(app);

    assert.deepEqual(patched, []);
    assert.deepEqual(commented, []);
    assert.equal(app.queries.isPosted(app.source, app.selected), false);
    assert.equal(app.issue.body, "Someone else's words.");
    assert.equal(doc.getElementById("confirm").hidden, true);
    assert.match(doc.getElementById("status").textContent, /changed since you read it/);
  });

  test("with every change rejected only the comment goes, and unchanged says so", async () => {
    const { diffText } = await import("../../web/src/domain/text-diff.js");

    app.commands.rejectHunk(app.source, app.selected, diffText(LIVE, PROPOSED)[0].id);

    openConfirm(app);
    assert.match(doc.getElementById("confirm-count").textContent, /description unchanged/);

    await post(app);

    assert.deepEqual(patched, []);
    assert.deepEqual(commented, ["Why the body should change."]);
    assert.equal(app.selected.postedUrl, "https://x/comment");
  });

  test("a comment the destination refuses records nothing, for a safe retry", async () => {
    refuseComment = true;

    await post(app);

    assert.deepEqual(patched, [PROPOSED]);
    assert.equal(app.queries.isPosted(app.source, app.selected), false);
    assert.equal(doc.getElementById("confirm").hidden, false);
    assert.match(doc.getElementById("status").textContent, /refused/);
    // The patch landed before the comment was refused, and the sheet says so
    // rather than claiming nothing went: the retry re-patches the same body,
    // which changes nothing, then sends the comment.
    assert.equal(
      doc.getElementById("confirm-note").textContent,
      "the description was updated; the comment was not sent",
    );
  });

  test("a draft proposing only a description still goes, on the patch's own link", async () => {
    await build(anIssueDraft({ comment: "" }));

    await post(app);

    assert.deepEqual(patched, [PROPOSED]);
    assert.deepEqual(commented, []);
    assert.equal(app.selected.postedUrl, "https://x/issue");
  });

  test("the sheet says the close, and the send closes after the comment", async () => {
    await build(anIssueDraft({ close: { reason: "not_planned" } }));

    openConfirm(app);
    assert.match(doc.getElementById("confirm-count").textContent, /closes as not planned/);

    await post(app);

    assert.deepEqual(closed, ["not_planned"]);
    assert.deepEqual(sequence, ["patch", "comment", "close"]);
    assert.equal(app.queries.isPosted(app.source, app.selected), true);
    // The close's url is the ticket itself, so it never wins the record.
    assert.equal(app.selected.postedUrl, "https://x/comment");
  });

  test("a duplicate close names the ticket it duplicates", () => {
    return build(anIssueDraft({ close: { reason: "duplicate", of: 482 } })).then(() => {
      openConfirm(app);
      assert.match(doc.getElementById("confirm-count").textContent, /closes as duplicate of #482/);
    });
  });

  test("a dropped close sends everything else and leaves the ticket open", async () => {
    await build(anIssueDraft({ close: { reason: "completed" } }));

    app.commands.dropClose(app.source, app.selected);
    await app.reselect();

    openConfirm(app);
    assert.match(doc.getElementById("confirm-count").textContent, /the ticket stays open/);

    await post(app);

    assert.deepEqual(closed, []);
    assert.deepEqual(sequence, ["patch", "comment"]);
    assert.equal(app.queries.isPosted(app.source, app.selected), true);
  });

  test("the prefix leads the triage comment, and an edit takes it off", async () => {
    app.commands.setCommentPrefix(app.source, "[bot-assisted]");

    await post(app);
    assert.deepEqual(commented, ["[bot-assisted] Why the body should change."]);

    // The prefix marks the agent's words; a comment the reader rewrote is the
    // reader's own, and goes out exactly as written.
    await build();
    app.commands.setCommentPrefix(app.source, "[bot-assisted]");
    app.commands.editComment(app.source, app.selected, "My own words.");
    await app.reselect();

    await post(app);
    assert.deepEqual(commented, ["My own words."]);
  });

  test("a close the destination refuses records nothing, and says how far it got", async () => {
    await build(anIssueDraft({ close: { reason: "not_planned" } }));
    refuseClose = true;

    await post(app);

    assert.deepEqual(patched, [PROPOSED]);
    assert.deepEqual(commented, ["Why the body should change."]);
    assert.equal(app.queries.isPosted(app.source, app.selected), false);
    assert.equal(doc.getElementById("confirm").hidden, false);
    // The patch and the comment landed before the close was refused, and the
    // sheet says so rather than claiming nothing went.
    assert.equal(
      doc.getElementById("confirm-note").textContent,
      "the description was updated; the comment was posted; the ticket was not closed",
    );
  });
});
