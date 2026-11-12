// The agent's terminal docks on the right, beside the code and its comments,
// for the item selected. It starts folded and loads nothing until unfolded.
// Folding keeps claude running; selecting another item stops it.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawTerminal } from "../../web/src/app/terminal.js";
import { stopVoice, toggleVoice } from "../../web/src/app/voice.js";

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
  let mic;

  beforeEach(() => {
    dock = stub("aside");
    dock.hidden = true;
    mic = stub("button");
    app = { terminal: { open: async () => ({ close() {}, write() {}, resize() {} }) }, selected: pull("a") };
    globalThis.document = {
      head: stub("head"),
      createElement: (tag) => stub(tag),
      getElementById: (id) => (id === "terminal-dock" ? dock : null),
    };
  });

  afterEach(() => {
    stopVoice();
    delete globalThis.SpeechRecognition;
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

  const host = () => dock.children.find((node) => node.className === "terminal-host");

  // Recognition that only says whether it is still listening.
  class Listening {
    start() {
      this.listening = true;
    }

    stop() {}

    abort() {
      this.listening = false;
    }
  }

  const talk = () => {
    app.voice = { ask: () => new Promise(() => {}), say: async () => {}, hush: async () => {} };
    globalThis.SpeechRecognition = Listening;
    document.getElementById = (id) => ({ "terminal-dock": dock, "voice-mic": mic })[id] ?? null;
  };
  test("carries no mic: the mic is in the header", () => {
    talk();
    drawTerminal(app);

    assert.deepEqual(buttons(dock).map((button) => button.className), ["terminal-fold"]);
  });

  // Both resume the same session; two writers would fork it.
  test("turning the mic on stops a running terminal and folds the dock", () => {
    talk();
    drawTerminal(app);
    titled(dock, "Expand").click();
    const drawing = host().children;

    toggleVoice(app);

    assert.equal(dock.classList.contains("collapsed"), true);
    assert.notEqual(host().children, drawing);
    assert.equal(mic["aria-pressed"], "true");
  });

  test("unfolding turns the mic off before the terminal starts", () => {
    talk();
    drawTerminal(app);
    toggleVoice(app);

    titled(dock, "Expand").click();

    assert.equal(mic["aria-pressed"], "false");
    assert.equal(loaded(), true);
  });

  test("unfolding while the agent thinks waits for its answer, then starts the terminal", async () => {
    let answer;
    let spoken = 0;
    let heard;

    talk();
    app.voice.ask = () => new Promise((done) => (answer = done));
    app.voice.say = async () => {
      spoken += 1;
    };
    globalThis.SpeechRecognition = class extends Listening {
      constructor() {
        super();
        heard = (words) => {
          const result = [{ transcript: words }];

          result.isFinal = true;
          this.onresult({ resultIndex: 0, results: [result] });
        };
      }
    };
    drawTerminal(app);
    toggleVoice(app);
    heard("why rename the column");

    titled(dock, "Expand").click();

    assert.equal(loaded(), false);
    assert.equal(mic["aria-pressed"], "true");

    answer({ reply: "Clarity.", session: "moved-on" });
    await new Promise((done) => setTimeout(done, 0));

    assert.equal(mic["aria-pressed"], "false");
    assert.equal(loaded(), true);
    assert.equal(spoken, 0);
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
