// The description pane: the proposed rewrite of a ticket's body, hunk by hunk.
//
// The reader keeps or rejects each hunk, and what would be written is always on
// screen below them: the kept hunks applied to the live body, until the reader
// writes their own. A body that never arrived is refused rather than diffed
// against "", because a diff against nothing proposes deleting the ticket.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { diffText } from "../../web/src/domain/text-diff.js";
import {
  closeDescriptionEditor,
  drawDescription,
  openDescriptionEditor,
} from "../../web/src/app/description-pane.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, aPull, agentWrites, theApp } from "../use-cases/helper.js";

const LIVE = "One.\nTwo.\nThree.";
const PROPOSED = "One.\nTwo, sharper.\nThree.";

// The smallest document the pane touches: elements found by id, built by tag,
// carrying children, text and click handlers. A real DOM would prove no more
// here and would mean a dependency in a project that has none.
function stub(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    value: "",
    hidden: false,
    children: [],
    dataset: {},
    handlers: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    setAttribute() {},
    focus() {},
    setSelectionRange() {},
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

// Every string a subtree says, for asserting on words without walking shapes.
function spoken(node) {
  return [node.textContent, ...(node.children || []).flatMap(spoken)].filter(Boolean);
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

describe("the description pane", () => {
  let app;
  let doc;

  beforeEach(async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, anIssueDraft());

    app = await theApp({
      adapter,
      pulls: [aPull({ isIssue: true })],
      destination: {
        issue: async () => ({ body: LIVE, title: "T", isPull: false, url: "" }),
      },
    });

    await app.select(app.queue()[0]);
    app.editingDescription = false;

    doc = fakeDocument();
    globalThis.document = doc;
  });

  afterEach(() => {
    delete globalThis.document;
  });

  const pane = () => doc.getElementById("description");
  const hunkId = () => diffText(LIVE, PROPOSED)[0].id;

  test("diffs the proposal against the live body, hunk by hunk", () => {
    drawDescription(app);

    // The same visual grammar as the diff pane: a row's kind is its class.
    const rows = pane().children.flatMap(spokenNodes);
    const del = rows.find((node) => node.className === "line del");
    const add = rows.find((node) => node.className === "line add");

    assert.equal(spoken(del).at(-1), "Two.");
    assert.equal(spoken(add).at(-1), "Two, sharper.");
    assert.ok(spoken(pane()).includes("Reject"));
  });

  test("a rejected hunk falls out of the result and offers the way back", () => {
    app.commands.rejectHunk(app.source, app.selected, hunkId());
    drawDescription(app);

    const words = spoken(pane());

    assert.ok(words.includes("Restore"), words);
    assert.ok(
      words.some((line) => line.includes("Nothing would change")),
      words,
    );
  });

  test("clicking the control records the decision", () => {
    drawDescription(app);

    const toggle = pane()
      .children.flatMap(spokenNodes)
      .find((node) => node.textContent === "Reject");

    toggle.handlers.click();

    assert.deepEqual(app.queries.rejectedHunks(app.source, app.selected), new Set([hunkId()]));
  });

  test("the result follows the kept hunks until the reader writes their own", () => {
    drawDescription(app);

    assert.ok(spoken(pane()).includes(PROPOSED));

    app.commands.editDescription(app.source, app.selected, "Mine.");
    drawDescription(app);

    const words = spoken(pane());

    assert.ok(words.includes("Mine."), words);
    assert.ok(
      words.some((line) => line.toLowerCase().includes("kept changes")),
      words,
    );
  });

  test("leaving the editor keeps what was typed, and an untouched box pins nothing", () => {
    drawDescription(app);
    openDescriptionEditor(app);

    assert.equal(doc.getElementById("description-editor").value, PROPOSED);

    closeDescriptionEditor(app);
    assert.equal(app.queries.descriptionFor(app.source, app.selected), null);

    openDescriptionEditor(app);
    doc.getElementById("description-editor").value = "Mine.";
    closeDescriptionEditor(app);

    assert.equal(app.queries.descriptionFor(app.source, app.selected), "Mine.");
  });

  test("will not diff against a body it never got", () => {
    app.issue = null;
    app.issueProblem = "rate limited";
    drawDescription(app);

    const words = spoken(pane());

    assert.ok(
      words.some((line) => line.includes("could not be fetched")),
      words,
    );
    assert.ok(
      words.some((line) => line.includes("rate limited")),
      words,
    );
  });
});

// Depth-first nodes of a subtree, for finding a control by its word.
function spokenNodes(node) {
  return [node, ...(node.children || []).flatMap(spokenNodes)];
}
