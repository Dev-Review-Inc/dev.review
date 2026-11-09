// The agent's terminal docks on the right, beside the code and its comments,
// for the item selected. It starts folded and loads nothing until unfolded.
// Folding keeps claude running; selecting another item stops it.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawTerminal } from "../../web/src/app/terminal.js";

function stub(tag = "div") {
  const listeners = {};
  const classes = new Set();

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
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name) {
        if (classes.has(name)) classes.delete(name);
        else classes.add(name);

        return classes.has(name);
      },
    },
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

function buttons(node) {
  return [...(node.tag === "button" ? [node] : []), ...(node.children || []).flatMap(buttons)];
}

const titled = (dock, words) => buttons(dock).find((button) => button.title.startsWith(words));

const agent = { session: "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90", cwd: "/Users/me/apps/app" };
const pull = (key, withAgent = agent) => ({ key, draft: { agent: withAgent } });

describe("the terminal dock", () => {
  let dock;
  let app;

  beforeEach(() => {
    dock = stub("aside");
    dock.hidden = true;
    app = { terminal: { open: async () => ({ close() {}, write() {}, resize() {} }) }, selected: pull("a") };
    globalThis.document = {
      head: stub("head"),
      createElement: (tag) => stub(tag),
      getElementById: (id) => (id === "terminal-dock" ? dock : null),
    };
  });

  afterEach(() => {
    app.selected = null;
    drawTerminal(app);
    delete globalThis.document;
  });

  // xterm needs a real page, so an unfold stops short of drawing it here.
  // Its stylesheet going in says loading began.
  const loaded = () => document.head.children.length > 0;

  test("shows folded beside an item whose agent it can resume, loading nothing", () => {
    drawTerminal(app);

    assert.equal(dock.hidden, false);
    assert.equal(dock.classList.contains("collapsed"), true);
    assert.equal(loaded(), false);
  });

  // A grip without the shared class is a grid row of its own, not a handle.
  test("carries a grip that drags it, like the rail's", () => {
    drawTerminal(app);

    assert.ok(dock.children.some((node) => node.className.split(" ").includes("grip")));
  });

  test("loads the terminal when unfolded, and keeps it when folded again", () => {
    drawTerminal(app);

    titled(dock, "Expand").click();
    assert.equal(dock.classList.contains("collapsed"), false);
    assert.equal(loaded(), true);

    titled(dock, "Collapse").click();
    assert.equal(dock.classList.contains("collapsed"), true);
    assert.equal(dock.hidden, false);
  });

  test("a redraw over the same item leaves the terminal be", () => {
    drawTerminal(app);
    titled(dock, "Expand").click();
    const drawn = dock.children;

    drawTerminal(app);

    assert.equal(dock.children, drawn);
    assert.equal(dock.classList.contains("collapsed"), false);
  });

  test("selecting another item tears the terminal down and folds", () => {
    drawTerminal(app);
    titled(dock, "Expand").click();
    const drawn = dock.children;

    app.selected = pull("b");
    drawTerminal(app);

    assert.notEqual(dock.children, drawn);
    assert.equal(dock.classList.contains("collapsed"), true);
  });

  test("hides beside an item with no agent, and where the build has no terminal", () => {
    app.selected = pull("b", null);
    drawTerminal(app);
    assert.equal(dock.hidden, true);

    app.selected = pull("a");
    app.terminal = null;
    drawTerminal(app);
    assert.equal(dock.hidden, true);
  });
});
