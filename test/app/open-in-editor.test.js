// The rail's way into the agent's folder, in the reader's own editor.
//
// One split button: the editor last chosen, and a caret that lists every
// installed editor. Offered only when the draft names the folder its agent
// ran in and the build can open an editor at all.

import { test, describe, afterEach, beforeEach } from "node:test";
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
      for (const node of nodes) node.parent = this;
      this.children.push(...nodes);
    },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
    },
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
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
    body: stub("body"),
    createElement: (tag) => stub(tag),
    querySelector: () => null,
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stub());

      return byId.get(id);
    },
  };
}

function withClass(name) {
  const find = (node) => [
    ...(String(node.className || "").split(" ").includes(name) ? [node] : []),
    ...(node.children || []).flatMap(find),
  ];

  return find;
}

const editorButtons = withClass("editor-button");
const carets = withClass("editor-caret");
const menus = withClass("editor-menu");

function memoryStore() {
  const items = new Map();

  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
}

const agent = { session: "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90", cwd: "/Users/me/apps/app" };

async function railButtons(draft, editorOpener) {
  const doc = await drawn(draft, editorOpener);

  return editorButtons(doc.getElementById("blurb"));
}

async function drawn(draft, editorOpener) {
  const adapter = new MemoryAdapter();

  await agentWrites(adapter, draft);

  const app = await theApp({ adapter, pulls: [aPull()] });

  app.editorOpener = editorOpener;
  await app.select(app.queue()[0]);

  const doc = fakeDocument();

  globalThis.document = doc;
  drawRail(app);

  return doc;
}

describe("opening the agent's folder in an editor", () => {
  let opened;
  let opener;

  beforeEach(() => {
    globalThis.localStorage = memoryStore();
    opened = [];
    opener = {
      editors: [
        { key: "zed", label: "Zed" },
        { key: "sublime", label: "Sublime" },
      ],
      open: async (key, folder) => opened.push([key, folder]),
    };
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  test("offers the first installed editor, and opens the agent's folder in it", async () => {
    const buttons = await railButtons(aDraft({ agent }), opener);

    assert.deepEqual(
      buttons.map((button) => button.textContent),
      ["Zed"],
    );

    buttons[0].click();
    assert.deepEqual(opened, [["zed", "/Users/me/apps/app"]]);
  });

  test("lists every installed editor behind the caret, and opens the one chosen", async () => {
    const doc = await drawn(aDraft({ agent }), opener);

    carets(doc.getElementById("blurb"))[0].click();

    const [menu] = menus(doc.body);

    assert.deepEqual(
      menu.children.map((choice) => choice.textContent),
      ["Zed", "Sublime"],
    );

    menu.children[1].click();
    assert.deepEqual(opened, [["sublime", "/Users/me/apps/app"]]);
    assert.deepEqual(menus(doc.body), []);
  });

  test("remembers the editor chosen, for the next draw", async () => {
    const doc = await drawn(aDraft({ agent }), opener);

    carets(doc.getElementById("blurb"))[0].click();
    menus(doc.body)[0].children[1].click();

    const buttons = await railButtons(aDraft({ agent }), opener);

    assert.deepEqual(
      buttons.map((button) => button.textContent),
      ["Sublime"],
    );
  });

  test("offers nothing when the draft names no folder", async () => {
    assert.deepEqual(await railButtons(aDraft(), opener), []);
  });

  test("offers nothing where the build cannot open an editor", async () => {
    assert.deepEqual(await railButtons(aDraft({ agent }), null), []);
  });
});
