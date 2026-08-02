// Whether the summary pane has anything of its own to say, or has to borrow
// the whole pane to say it.
//
// A draft file existing is the line: once the agent has written one, however
// little of it is filled in, the pane is its to draw - drawSummary's own
// progress banner says what is still coming. Only "no draft file at all" still
// borrows the pane outright, because there is nothing here yet to draw.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { blankState } from "../../web/src/app/summary.js";

// The smallest document blankState's remaining branches touch. A real DOM
// would prove no more here and would mean a dependency in a project that has
// none.
function fakeDocument() {
  const make = (tag) => ({
    tag,
    className: "",
    textContent: "",
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
    querySelector() {
      return this.children.find((child) => child.className === "empty-inner") || null;
    },
  });

  return { createElement: make };
}

describe("a draft file that exists", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("is never replaced by a full-screen waiting state, however little it holds", () => {
    const app = {
      source: {},
      problem: null,
      destination: {},
      selected: { draft: { finishedAt: "", sections: [], findings: [] } },
      drafts: null,
      filter: {},
      queue: () => [],
    };

    assert.equal(blankState(app), null);
  });

  test("is never replaced once it is finished, either", () => {
    const app = {
      source: {},
      problem: null,
      destination: {},
      selected: { draft: { finishedAt: "2026-07-29T15:41:10Z", sections: [], findings: [] } },
      drafts: null,
      filter: {},
      queue: () => [],
    };

    assert.equal(blankState(app), null);
  });
});

describe("no draft file at all", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("still borrows the pane, because there is nothing here yet to draw", () => {
    globalThis.document = fakeDocument();

    const app = {
      source: {},
      problem: null,
      destination: {},
      selected: { draft: null },
      drafts: null,
      filter: {},
      queue: () => [],
    };

    const state = blankState(app);
    const inner = state.children[0];

    assert.notEqual(state, null);
    assert.ok(inner.children.some((child) => child.textContent === "No review has started."));
  });
});
