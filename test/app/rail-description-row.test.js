// The rail's way into the description pane.
//
// A "Description" row exists exactly when the draft proposes one, mirroring
// the QA row: a way in that is only offered when there is something behind it.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawRail } from "../../web/src/app/rail.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, aPull, agentWrites, theApp } from "../use-cases/helper.js";

function stub(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
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

function spoken(node) {
  return [node.textContent, ...(node.children || []).flatMap(spoken)].filter(Boolean);
}

async function railWords(draft) {
  const adapter = new MemoryAdapter();

  await agentWrites(adapter, draft);

  const app = await theApp({ adapter, pulls: [aPull({ isIssue: true })] });

  await app.select(app.queue()[0]);

  const doc = fakeDocument();

  globalThis.document = doc;
  drawRail(app);

  return spoken(doc.getElementById("analysis"));
}

describe("the rail over a draft", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("offers the description exactly when one is proposed", async () => {
    const words = await railWords(
      aDraft({ verdict: "", findings: [], sections: [], description: "New body.", comment: "Why." }),
    );

    assert.ok(words.includes("Description"), words);
  });

  test("offers no way into a pane with nothing behind it", async () => {
    const words = await railWords(aDraft());

    assert.equal(words.includes("Description"), false, words);
  });
});
