// Saying what moved since the draft was written.
//
// A second badge beside the settled chip, in the same provenance line: "N
// commits since review" for a pull request, "N comments since triage" for an
// issue. Clicking it expands the list in place. Nothing is drawn at all when
// app.drift is null - no reviewedAt, no drift, unknown, or a failed fetch -
// same philosophy as the settled chip's own precedent: this must never read
// as a false "nothing changed".

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawRail } from "../../web/src/app/rail.js";
import { openConfirm } from "../../web/src/app/confirm.js";
import { aPull, theApp } from "../use-cases/helper.js";

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
    listeners: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
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
    querySelector: () => null,
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stub());

      return byId.get(id);
    },
  };
}

function flatten(node) {
  return [node, ...(node.children || []).flatMap(flatten)];
}

function chip(node) {
  return flatten(node).find((n) => String(n.className || "").includes("drift-chip"));
}

async function anApp({ isIssue = false, destination = {} } = {}) {
  const pull = aPull(isIssue ? { isIssue: true } : {});
  const app = await theApp({ pulls: [pull], destination });

  await app.select(app.queue()[0]);

  return app;
}

describe("the drift badge beside the number", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  async function railChip(options) {
    const app = await anApp(options);
    const doc = fakeDocument();

    globalThis.document = doc;
    drawRail(app);

    return { app, doc, chip: chip(doc.getElementById("blurb")) };
  }

  test("a reviewed sha that diverged without moving ahead wears no badge", async () => {
    // A force-push can leave reviewedAt and headCommit different while GitHub's
    // own compare says nothing is actually ahead - history moved sideways, not
    // forward. Zero is not a count worth wearing: it reads as "something
    // happened" when nothing did, the exact false positive this badge exists
    // to avoid on the other side.
    const { chip: badge } = await railChip({
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async () => ({ aheadBy: 0, commits: [] }),
      },
    });

    assert.equal(badge, undefined);
  });

  test("a pull request with commits pushed since the review wears a count", async () => {
    const { chip: badge } = await railChip({
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async () => ({
          aheadBy: 2,
          commits: [
            { sha: "a1b2c3d", message: "Fix the family catch-all", author: "someone", date: "2026-08-30T09:00:00Z" },
            { sha: "b2c3d4e", message: "Tidy up", author: "another", date: "2026-08-30T10:00:00Z" },
          ],
        }),
      },
    });

    assert.equal(badge.textContent, "2 commits since review");
  });

  test("one commit is singular", async () => {
    const { chip: badge } = await railChip({
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async () => ({
          aheadBy: 1,
          commits: [{ sha: "a1b2c3d", message: "Fix it", author: "someone", date: "2026-08-30T09:00:00Z" }],
        }),
      },
    });

    assert.equal(badge.textContent, "1 commit since review");
  });

  test("an issue with comments left since triage wears a count", async () => {
    const { chip: badge } = await railChip({
      isIssue: true,
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "open",
          stateReason: null,
          closedAt: null,
          commentsCount: 2,
          updatedAt: "2026-07-30T00:00:00Z",
        }),
        issueComments: async () => [
          { author: "sofia", body: "still broken", createdAt: "2026-07-30T00:00:00Z" },
        ],
      },
    });

    assert.equal(badge.textContent, "1 comment since triage");
  });

  test("nothing has moved: no badge", async () => {
    const { chip: badge } = await railChip({});

    assert.equal(badge, undefined);
  });

  test("a destination that would not answer: no badge - unknown is not no drift", async () => {
    const { chip: badge } = await railChip({
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async () => {
          throw new Error("the api answered 404");
        },
      },
    });

    assert.equal(badge, undefined);
  });

  test("clicking the badge expands the list of commits", async () => {
    const { app, doc, chip: badge } = await railChip({
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async () => ({
          aheadBy: 1,
          commits: [{ sha: "a1b2c3d4e5f6", message: "Fix the family catch-all", author: "someone", date: "2026-08-30T09:00:00Z" }],
        }),
      },
    });

    assert.equal(app.driftExpanded, false);

    badge.listeners.click();

    assert.equal(app.driftExpanded, true);

    drawRail(app);

    const text = flatten(doc.getElementById("blurb"))
      .map((n) => n.textContent)
      .join(" ");

    assert.match(text, /a1b2c3d/);
    assert.match(text, /Fix the family catch-all/);
    assert.match(text, /someone/);
  });
});

describe("the sheet's note over drift since the draft was written", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  async function sheetNote(options) {
    const app = await anApp(options);
    const doc = fakeDocument();

    globalThis.document = doc;
    openConfirm(app);

    return doc.getElementById("confirm-note").textContent;
  }

  test("a pull request with pushed commits says so, pluralised", async () => {
    const note = await sheetNote({
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async () => ({
          aheadBy: 2,
          commits: [
            { sha: "a1b2c3d", message: "m1", author: "a", date: "2026-08-30T09:00:00Z" },
            { sha: "b2c3d4e", message: "m2", author: "b", date: "2026-08-30T10:00:00Z" },
          ],
        }),
      },
    });

    assert.equal(
      note,
      "2 commits have been pushed since this review was written · nothing has been sent yet",
    );
  });

  test("an issue with new comments says so", async () => {
    const note = await sheetNote({
      isIssue: true,
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "open",
          stateReason: null,
          closedAt: null,
          commentsCount: 1,
          updatedAt: "2026-07-30T00:00:00Z",
        }),
        issueComments: async () => [
          { author: "sofia", body: "still broken", createdAt: "2026-07-30T00:00:00Z" },
        ],
      },
    });

    assert.equal(
      note,
      "1 comment has been added since this ticket was triaged · nothing has been sent yet",
    );
  });

  test("nothing has moved: the note says nothing about drift", async () => {
    assert.equal(await sheetNote({}), "nothing has been sent yet");
  });
});
