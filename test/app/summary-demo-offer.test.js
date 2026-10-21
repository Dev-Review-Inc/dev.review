// The way into the sample data, for a reader who has nothing attached yet.
//
// Until now the only way to reach the demo was `?demo=1`, which a native build
// has no way to carry: a Tauri webview has no query string. So the empty state
// offers it as a plainly-labelled control instead - on the no-source state
// only, because that is the one state where attaching the sample data is both
// possible and harmless. A reader who already has a source has work of their
// own, and installDemo would refuse them anyway.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { blankState } from "../../web/src/app/summary.js";
import { demoWanted, installDemo } from "../../web/src/app/demo.js";

// The smallest document this draws in, recording the click listeners so a
// button can actually be pressed. A real DOM would prove no more and would
// mean a dependency in a project that has none.
function fakeDocument() {
  const make = (tag) => ({
    tag,
    className: "",
    textContent: "",
    children: [],
    listeners: {},
    style: { cssText: "", setProperty() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    querySelector() {
      return this.children.find((child) => child.className === "empty-inner") || null;
    },
  });

  return { createElement: make };
}

const SAMPLE = "Try the sample data";

function buttons(state) {
  return state.children[0].children.filter((child) => child.tag === "button");
}

function labelled(state, label) {
  return buttons(state).find((child) => child.textContent === label) || null;
}

// An app with nothing attached, recording what it was asked to attach.
function blankApp() {
  const sources = [];
  const destinations = [];
  const opened = { source: null, destination: null };
  const preferences = {};

  return {
    source: null,
    problem: null,
    destination: null,
    selected: null,
    drafts: null,
    filter: {},
    queue: () => [],
    sources,
    destinations,
    opened,
    preferences,
    queries: {
      allSources: () => sources,
      allDestinations: () => destinations,
    },
    commands: {
      async addSource(setup) {
        const source = { id: `source-${sources.length + 1}`, ...setup };

        sources.push(source);

        return source;
      },
      async addDestination(setup) {
        const destination = { id: `destination-${destinations.length + 1}`, ...setup };

        destinations.push(destination);

        return destination;
      },
    },
    state: {
      async setPreference(name, value) {
        preferences[name] = value;
      },
    },
    async switchSource(source) {
      opened.source = source;
    },
    async switchDestination(destination) {
      opened.destination = destination;
    },
  };
}

describe("no draft source attached", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("offers the sample data beside attaching a source", () => {
    globalThis.document = fakeDocument();

    const state = blankState(blankApp());

    assert.ok(labelled(state, "Attach a source"));
    assert.ok(labelled(state, SAMPLE));
  });

  test("says what the sample data is, so nobody reads it as real work", () => {
    globalThis.document = fakeDocument();

    const state = blankState(blankApp());
    const words = state.children[0].children.map((child) => child.textContent).join(" ");

    assert.match(words, /sample/i);
    assert.match(words, /posts nowhere/);
  });

  test("attaches the sample data when pressed, and opens what it attached", async () => {
    globalThis.document = fakeDocument();

    const app = blankApp();
    const offer = labelled(blankState(app), SAMPLE);

    await Promise.all(offer.listeners.click.map((handler) => handler()));

    assert.equal(app.sources.length, 2);
    assert.ok(app.sources.every((source) => source.adapter.type === "demo"));
    assert.equal(app.destinations.length, 1);
    assert.equal(app.destinations[0].type, "demo");
    // Opened, not merely attached: this runs long after boot, so nothing else
    // is going to open them, and a half-opened pane is what that looks like.
    assert.equal(app.opened.source, app.sources[0]);
    assert.equal(app.opened.destination, app.destinations[0]);
  });

  test("is not offered once this browser holds a source of its own", () => {
    globalThis.document = fakeDocument();

    const app = blankApp();

    app.sources.push({ id: "mine", adapter: { type: "s3" } });

    const state = blankState(app);

    assert.ok(labelled(state, "Attach a source"));
    assert.equal(labelled(state, SAMPLE), null);
  });
});

describe("the sample data itself", () => {
  test("refuses a browser that already holds a source, so nothing real is lost", async () => {
    const app = blankApp();
    const mine = { id: "mine", adapter: { type: "s3" } };

    app.sources.push(mine);

    assert.equal(await installDemo(app), null);
    assert.deepEqual(app.sources, [mine]);
    assert.deepEqual(app.destinations, []);
    assert.deepEqual(app.preferences, {});
  });

  test("is still reached by the query string, which is how a browser asks", () => {
    assert.equal(demoWanted("?demo=1"), true);
    assert.equal(demoWanted(""), false);
  });
});

describe("no destination configured", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("does not offer the sample data: a source is attached, so it would refuse", () => {
    globalThis.document = fakeDocument();

    const app = blankApp();

    app.sources.push({ id: "mine", adapter: { type: "s3" } });
    app.source = app.sources[0];

    const state = blankState(app);

    assert.ok(labelled(state, "Add a destination"));
    assert.equal(labelled(state, SAMPLE), null);
  });
});
