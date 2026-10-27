// The reviewers beside the pull request's number: who was asked, people and
// teams, and whether each has answered yet. Unknown draws nothing, the same
// as the settled chip.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawRail } from "../../web/src/app/rail.js";
import { aPull, theApp } from "../use-cases/helper.js";

function stub(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    title: "",
    hidden: false,
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
  const own = String(node.className || "").includes("reviewer-chip") ? [node] : [];

  return [...own, ...(node.children || []).flatMap(chips)];
}

async function railChips(destination) {
  const app = await theApp({ pulls: [aPull()], destination });

  await app.select(app.queue()[0]);

  const doc = fakeDocument();
  globalThis.document = doc;
  drawRail(app);

  return chips(doc.getElementById("blurb"));
}

describe("the reviewers beside the number", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("each reviewer wears what they said, in its tone", async () => {
    const found = await railChips({
      reviewers: async () => [
        { name: "ana", team: false, state: "approved" },
        { name: "ben", team: false, state: "changes requested" },
        { name: "org/web", team: true, state: "waiting" },
        { name: "org/api", team: true, state: "commented", by: "cy" },
      ],
    });

    assert.deepEqual(
      found.map((chip) => [chip.textContent, chip.className.match(/is-\w+/)[0]]),
      [
        ["ana approved", "is-ok"],
        ["ben changes requested", "is-critical"],
        ["org/web waiting", "is-warn"],
        ["org/api commented", "is-neutral"],
      ],
    );
    assert.equal(found[3].title, "by cy");
  });

  test("a destination that will not say draws no reviewers", async () => {
    const found = await railChips({
      reviewers: async () => {
        throw new Error("rate limited");
      },
    });

    assert.deepEqual(found, []);
  });
});
