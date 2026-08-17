// Promises nobody is holding.
//
// A timer's callback, a click listener and a watch's notification all discard
// whatever they return. Anything that fails in one of them becomes an unhandled
// rejection, and an unhandled rejection in this app goes to the browser console
// and nowhere else: the reader clicks, nothing happens, and nothing says why.
//
// So every one of these is driven here with something underneath it broken, and
// what is asserted is that the failure was held. Where it is worth telling the
// reader, that it was told; where it is a background round that will come again
// in two seconds, that the interface was not left claiming the work was done.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { backstop } from "../../web/src/app/backstop.js";
import { dismiss } from "../../web/src/app/confirm.js";
import { restore } from "../../web/src/app/header.js";
import { Drafts } from "../../web/src/state/drafts.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, agentWrites, anApp, aPull, theApp } from "../use-cases/helper.js";

// The queue refresh runs every five minutes, which is not a thing a test can
// wait out. What it hands `setInterval` is captured instead and called here,
// which is the same callback the browser would call.
const REFRESH = 5 * 60 * 1000;

/**
 * Let every pending microtask and timer callback run.
 *
 * An unhandled rejection is only unhandled once nothing has attached to it, so
 * asserting on one means giving the round it came from time to finish.
 *
 * @returns {Promise<void>} when the queue is empty
 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * A collector for anything that rejects with nobody holding it.
 *
 * @returns {{rejections: object[], stop: () => void}} what escaped, and how to stop listening
 */
function watchForRejections() {
  const rejections = [];
  const note = (reason) => rejections.push(reason);

  process.on("unhandledRejection", note);

  return { rejections, stop: () => process.off("unhandledRejection", note) };
}

/**
 * The smallest document `say` touches: one element per place it reports in.
 *
 * Hand-rolled for the same reason the renderer's test hand-rolls one - a real
 * DOM would prove no more here and would mean a dependency in a project that
 * has none.
 *
 * @returns {object} a document, with what was said readable off it
 */
function aPage() {
  const nodes = new Map();

  return {
    getElementById(id) {
      if (!nodes.has(id)) {
        nodes.set(id, { textContent: "", className: "", hidden: false, parentElement: null });
      }

      return nodes.get(id);
    },
    said: () => nodes.get("status")?.textContent || "",
    tone: () => nodes.get("status")?.className || "",
  };
}

describe("the queue refresh, which nobody awaits", () => {
  let watching;
  let page;

  beforeEach(() => {
    watching = watchForRejections();
    page = aPage();
    globalThis.document = page;
  });

  afterEach(() => {
    watching.stop();
    delete globalThis.document;
  });

  /**
   * An app whose refresh timer has been caught rather than started.
   *
   * @returns {Promise<{app: object, refresh: () => unknown}>} the app and its timer's callback
   */
  async function anAppWithACaughtTimer() {
    const real = globalThis.setInterval;
    const captured = [];

    globalThis.setInterval = (fn, ms) => {
      captured.push({ fn, ms });

      return { unref() {} };
    };

    try {
      const app = await theApp();

      return { app, refresh: captured.find((entry) => entry.ms === REFRESH).fn };
    } finally {
      globalThis.setInterval = real;
    }
  }

  test("does not reject into nobody's hands when the source cannot be listed", async () => {
    const { app, refresh } = await anAppWithACaughtTimer();

    app.drafts.adapter.list = async () => {
      throw new Error("the bucket is unreachable");
    };

    refresh();

    await flush();

    assert.deepEqual(watching.rejections, []);
  });

  test("leaves the reason on the source rather than in the console", async () => {
    const { app, refresh } = await anAppWithACaughtTimer();

    app.drafts.adapter.list = async () => {
      throw new Error("the bucket is unreachable");
    };

    refresh();

    await flush();

    assert.equal(app.healthOf(app.source).state, "broken");
    assert.equal(app.healthOf(app.source).reason, "the bucket is unreachable");
  });
});

describe("dismissing a pull request, from a click listener", () => {
  let watching;
  let page;

  beforeEach(() => {
    watching = watchForRejections();
    page = aPage();
    globalThis.document = page;
  });

  afterEach(() => {
    watching.stop();
    delete globalThis.document;
  });

  test("says why when the decision cannot be written down", async () => {
    const app = await theApp();

    await app.select(app.queue()[0]);
    app.dismissing = true;
    app.commands.dismissPull = async () => {
      throw new Error("this browser will not keep anything");
    };

    await dismiss(app);

    assert.equal(page.said(), "this browser will not keep anything");
    assert.equal(page.tone(), "error");
  });

  test("leaves the review open, because it was not dismissed", async () => {
    const app = await theApp();

    await app.select(app.queue()[0]);
    app.dismissing = true;
    app.commands.dismissPull = async () => {
      throw new Error("this browser will not keep anything");
    };

    await dismiss(app);

    assert.notEqual(app.selected, null);
    assert.equal(app.dismissing, true);
  });

  test("does not reject into nobody's hands", async () => {
    const app = await theApp();

    await app.select(app.queue()[0]);
    app.dismissing = true;
    app.commands.dismissPull = async () => {
      throw new Error("this browser will not keep anything");
    };

    dismiss(app);

    await flush();

    assert.deepEqual(watching.rejections, []);
  });
});

describe("restoring a dismissed pull request, from a click listener", () => {
  let watching;
  let page;

  beforeEach(() => {
    watching = watchForRejections();
    page = aPage();
    globalThis.document = page;
  });

  afterEach(() => {
    watching.stop();
    delete globalThis.document;
  });

  test("says why when the pull request cannot be put back", async () => {
    const app = await theApp();

    app.commands.restorePull = async () => {
      throw new Error("this browser will not keep anything");
    };

    await restore(app, aPull());

    assert.equal(page.said(), "this browser will not keep anything");
    assert.equal(page.tone(), "error");
  });

  test("does not reject into nobody's hands", async () => {
    const app = await theApp();

    app.commands.restorePull = async () => {
      throw new Error("this browser will not keep anything");
    };

    restore(app, aPull());

    await flush();

    assert.deepEqual(watching.rejections, []);
  });
});

describe("the drafts watch, which runs every two seconds", () => {
  let watching;

  beforeEach(() => {
    watching = watchForRejections();
  });

  afterEach(() => {
    watching.stop();
  });

  test("holds a listener that fails rather than letting the round reject", async () => {
    const adapter = new MemoryAdapter();
    const drafts = new Drafts({ adapter });

    drafts.watch(async () => {
      throw new Error("the redraw fell over");
    });

    await agentWrites(adapter, aDraft());
    await adapter.poll();
    await flush();

    assert.deepEqual(watching.rejections, []);
  });
});

describe("the sync watch, which runs every two seconds", () => {
  let watching;

  beforeEach(() => {
    watching = watchForRejections();
  });

  afterEach(() => {
    watching.stop();
  });

  test("holds a listener that fails rather than letting the round reject", async () => {
    const adapter = new MemoryAdapter();
    const laptop = await anApp({ adapter, deviceId: "laptop" });
    const desktop = await anApp({ adapter, deviceId: "desktop" });

    desktop.sync.watch(desktop.source, async () => {
      throw new Error("the redraw fell over");
    });

    laptop.commands.dismissPull(laptop.source, laptop.open());
    await laptop.sync.push(laptop.source);

    await adapter.poll();
    await flush();

    assert.deepEqual(watching.rejections, []);
  });
});

describe("the backstop under everything", () => {
  /**
   * A scope that records what was registered on it and can raise it.
   *
   * @returns {object} the scope, with a way to raise an event on it
   */
  function aScope() {
    const listeners = new Map();

    return {
      addEventListener: (name, handler) => listeners.set(name, handler),
      raise: (name, event) => listeners.get(name)?.(event),
      registered: () => [...listeners.keys()].sort(),
    };
  }

  test("listens for both the ways a failure can escape", () => {
    const scope = aScope();

    backstop(scope, () => {});

    assert.deepEqual(scope.registered(), ["error", "unhandledrejection"]);
  });

  test("reports a rejection nobody held", () => {
    const scope = aScope();
    const said = [];

    backstop(scope, (message, tone) => said.push([message, tone]));
    scope.raise("unhandledrejection", { reason: new Error("nobody caught this") });

    assert.deepEqual(said, [["nobody caught this", "error"]]);
  });

  test("reports an error nobody caught", () => {
    const scope = aScope();
    const said = [];

    backstop(scope, (message, tone) => said.push([message, tone]));
    scope.raise("error", { error: new Error("nobody caught this either") });

    assert.deepEqual(said, [["nobody caught this either", "error"]]);
  });

  // Something thrown that was never an Error has no message. `say` has its own
  // wording for that, so what is passed on is what there was.
  test("passes on a failure that was never an Error", () => {
    const scope = aScope();
    const said = [];

    backstop(scope, (message, tone) => said.push([message, tone]));
    scope.raise("unhandledrejection", { reason: "a bare string" });

    assert.deepEqual(said, [[undefined, "error"]]);
  });

  // Every Chromium browser fires this as a real error event the moment a
  // ResizeObserver callback's own layout change would trigger another resize
  // in the same frame - a scheduling detail the browser is reporting on
  // itself, not a catch this app is missing. Telling the reader would be a
  // false alarm on every one of those browsers, not an occasional one.
  test("does not report the ResizeObserver loop warning every Chromium browser fires", () => {
    const scope = aScope();
    const said = [];

    backstop(scope, (message, tone) => said.push([message, tone]));
    scope.raise("error", {
      error: new Error("ResizeObserver loop completed with undelivered notifications."),
    });

    assert.deepEqual(said, []);
  });

  test("still reports a real error whose message happens to start differently", () => {
    const scope = aScope();
    const said = [];

    backstop(scope, (message, tone) => said.push([message, tone]));
    scope.raise("error", { error: new Error("the draft could not be read") });

    assert.deepEqual(said, [["the draft could not be read", "error"]]);
  });
});
