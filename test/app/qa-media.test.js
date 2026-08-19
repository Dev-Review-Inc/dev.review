// Recordings across redraws.
//
// The interface redraws whole on every change, and a change arrives every few
// seconds while a sweep is writing. A recording that is re-fetched on each of
// those draws flashes blank and forgets its place, which reads as the app
// reloading. So the object URL is held across draws keyed by the draft's own
// draftedAt: a redraw over the same draft reuses it synchronously, and only a
// redraft - the one moment the evidence may genuinely differ - reads it again.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { qaContent, releaseMedia } from "../../web/src/app/qa.js";

function stub(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
    src: "",
    children: [],
    listeners: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceWith() {},
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    },
  };
}

function fakeDocument() {
  return { createElement: (tag) => stub(tag) };
}

const RUN = {
  id: "repro",
  url: "",
  what: "reproduce it",
  verdict: "pass",
  video: "org--app-42/qa/repro.mp4",
  frames: 3,
  durationMs: 1200,
};

function anApp(draftedAt, media) {
  return {
    selected: {
      draft: { draftedAt, qa: { note: "", scenarios: [RUN] } },
    },
    adapter: { media },
  };
}

// The pieces come back synchronously; the fetch inside settles on a microtask.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function videoOf(pieces) {
  const scenario = pieces.find((piece) => piece.className.startsWith("scenario is-"));

  return scenario.children.find((child) => child.tag === "video");
}

describe("a recording across redraws", () => {
  let fetches;
  let released;
  let media;

  beforeEach(() => {
    globalThis.document = fakeDocument();
    fetches = 0;
    released = 0;
    media = async () => {
      fetches += 1;

      return { url: `blob:take-${fetches}`, release: () => (released += 1) };
    };
  });

  afterEach(() => {
    releaseMedia();
    releaseMedia();
    delete globalThis.document;
  });

  test("is fetched once, however many draws show it", async () => {
    const app = anApp("2026-08-17T10:00:00Z", media);

    const first = videoOf(qaContent(app, { report: false }));

    await settled();
    assert.equal(first.src, "blob:take-1");

    releaseMedia();
    const second = videoOf(qaContent(app, { report: false }));

    // Synchronously: the held url is already on the element, no blank frame.
    assert.equal(second.src, "blob:take-1");
    assert.equal(fetches, 1);
    assert.equal(released, 0);
  });

  test("is read again when the draft was redrafted, and the old blob given back", async () => {
    videoOf(qaContent(anApp("2026-08-17T10:00:00Z", media), { report: false }));
    await settled();

    releaseMedia();
    const after = videoOf(qaContent(anApp("2026-08-17T10:05:00Z", media), { report: false }));

    await settled();
    assert.equal(after.src, "blob:take-2");
    assert.equal(fetches, 2);

    // The first blob is unused now; the next draw's sweep gives it back.
    releaseMedia();
    assert.equal(released, 1);
  });

  test("remembers its place when the element is rebuilt", async () => {
    const app = anApp("2026-08-17T10:00:00Z", media);

    const first = videoOf(qaContent(app, { report: false }));

    await settled();
    first.currentTime = 12.5;
    first.listeners.timeupdate?.();

    releaseMedia();
    const second = videoOf(qaContent(app, { report: false }));

    second.listeners.loadedmetadata?.();
    assert.equal(second.currentTime, 12.5);
  });

  test("gives everything back once nothing draws it", async () => {
    videoOf(qaContent(anApp("2026-08-17T10:00:00Z", media), { report: false }));
    await settled();

    releaseMedia();
    releaseMedia();
    assert.equal(released, 1);
  });
});
