// The rail's way into the agent's folder, in the reader's own editor.
//
// One button per installed editor, offered only when the draft names the
// folder its agent ran in and the build can open an editor at all.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawRail } from "../../web/src/app/rail.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, aPull, agentWrites, theApp } from "../use-cases/helper.js";

function stub(tag = "div") {
  const listeners = {};

  return {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
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
    addEventListener(name, handler) {
      (listeners[name] = listeners[name] || []).push(handler);
    },
    click() {
      for (const handler of listeners.click || []) handler({ target: this });
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    removeAttribute() {},
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

function editorButtons(node) {
  const own = String(node.className || "").split(" ").includes("editor-button") ? [node] : [];

  return [...own, ...(node.children || []).flatMap(editorButtons)];
}

const agent = { session: "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90", cwd: "/Users/me/apps/app" };

async function railButtons(draft, editorOpener) {
  const adapter = new MemoryAdapter();

  await agentWrites(adapter, draft);

  const app = await theApp({ adapter, pulls: [aPull()] });

  app.editorOpener = editorOpener;
  await app.select(app.queue()[0]);

  const doc = fakeDocument();

  globalThis.document = doc;
  drawRail(app);

  return editorButtons(doc.getElementById("blurb"));
}

describe("opening the agent's folder in an editor", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("offers each installed editor, and opens the agent's folder in it", async () => {
    const opened = [];
    const opener = {
      editors: [
        { key: "zed", label: "Zed" },
        { key: "sublime", label: "Sublime" },
      ],
      open: async (key, folder) => opened.push([key, folder]),
    };

    const buttons = await railButtons(aDraft({ agent }), opener);

    assert.deepEqual(
      buttons.map((button) => button.textContent),
      ["Zed", "Sublime"],
    );

    buttons[1].click();
    assert.deepEqual(opened, [["sublime", "/Users/me/apps/app"]]);
  });

  test("offers nothing when the draft names no folder", async () => {
    const opener = { editors: [{ key: "zed", label: "Zed" }], open: async () => {} };

    assert.deepEqual(await railButtons(aDraft(), opener), []);
  });

  test("offers nothing where the build cannot open an editor", async () => {
    assert.deepEqual(await railButtons(aDraft({ agent }), null), []);
  });
});
