// Saying that the conversation is already over.
//
// A draft outlives its pull request, so the reader can open one already merged
// or closed. The rail wears a small chip beside the number - merged in green,
// a dead pull request in red, a closed issue in plain grey - and the sheet
// says where the send would land. Nothing is disabled: GitHub takes reviews on
// closed conversations, and saying so is the job. Open and unknown both say
// nothing, because unknown is not open.

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
    querySelector: () => null,
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stub());

      return byId.get(id);
    },
  };
}

function chips(node) {
  const own = String(node.className || "").includes("settled-chip") ? [node] : [];

  return [...own, ...(node.children || []).flatMap(chips)];
}

async function anApp({ isIssue = false, destination = {} } = {}) {
  const pull = aPull(isIssue ? { isIssue: true } : {});
  const app = await theApp({ pulls: [pull], destination });

  await app.select(app.queue()[0]);

  return app;
}

describe("the chip beside the number", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  async function railChips(options) {
    const app = await anApp(options);
    const doc = fakeDocument();

    globalThis.document = doc;
    drawRail(app);

    return chips(doc.getElementById("blurb"));
  }

  test("a merged pull request wears merged, in the good tone", async () => {
    const [chip] = await railChips({
      destination: {
        pullDetail: async () => ({
          headCommit: "e612b1b",
          state: "closed",
          merged: true,
          mergedAt: "2026-08-30T10:00:00Z",
          closedAt: "2026-08-30T10:00:00Z",
        }),
      },
    });

    assert.equal(chip.textContent, "merged");
    assert.match(chip.className, /is-ok/);
  });

  test("a closed, unmerged pull request wears closed, in the critical tone", async () => {
    const [chip] = await railChips({
      destination: {
        pullDetail: async () => ({
          headCommit: "e612b1b",
          state: "closed",
          merged: false,
          mergedAt: null,
          closedAt: "2026-08-30T10:00:00Z",
        }),
      },
    });

    assert.equal(chip.textContent, "closed");
    assert.match(chip.className, /is-critical/);
  });

  test("a closed issue wears closed in the neutral tone - closed is often just done", async () => {
    const [chip] = await railChips({
      isIssue: true,
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "closed",
          stateReason: "completed",
          closedAt: "2026-08-30T10:00:00Z",
        }),
      },
    });

    assert.equal(chip.textContent, "closed");
    assert.match(chip.className, /is-neutral/);
  });

  test("an open pull request wears nothing", async () => {
    assert.deepEqual(await railChips({}), []);
  });

  test("a destination that would not answer wears nothing - unknown is not open", async () => {
    assert.deepEqual(
      await railChips({
        destination: {
          pullDetail: async () => {
            throw new Error("the api answered 403");
          },
        },
      }),
      [],
    );
  });
});

describe("the sheet's note over a settled conversation", () => {
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

  test("the review sheet says a merged pull request is already merged", async () => {
    const note = await sheetNote({
      destination: {
        pullDetail: async () => ({
          headCommit: "e612b1b",
          state: "closed",
          merged: true,
          mergedAt: "2026-08-30T10:00:00Z",
          closedAt: "2026-08-30T10:00:00Z",
        }),
      },
    });

    assert.equal(
      note,
      "this pull request is already merged - the review will land on a closed conversation · nothing has been sent yet",
    );
  });

  test("and says closed when it died unmerged", async () => {
    const note = await sheetNote({
      destination: {
        pullDetail: async () => ({
          headCommit: "e612b1b",
          state: "closed",
          merged: false,
          mergedAt: null,
          closedAt: "2026-08-30T10:00:00Z",
        }),
      },
    });

    assert.match(note, /^this pull request is already closed - the review will land on a closed conversation/);
  });

  test("the triage sheet says the issue is already closed", async () => {
    const note = await sheetNote({
      isIssue: true,
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "closed",
          stateReason: "not_planned",
          closedAt: "2026-08-30T10:00:00Z",
        }),
      },
    });

    assert.match(note, /^this issue is already closed - the triage will land on a closed conversation/);
  });

  test("an open conversation keeps the destination's own note alone", async () => {
    assert.equal(await sheetNote({}), "nothing has been sent yet");
  });
});
