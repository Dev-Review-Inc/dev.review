// Where a failure gets said.
//
// The interface reports into a line in its footer, and then puts modals, a
// celebration and an opaque start up curtain over the top of it. A reader who
// asked a settings panel to attach a folder and got nothing back was not being
// told nothing: they were being told in a place the panel was standing in
// front of. So every overlay that is up carries the same report, every overlay
// that is not carries none, and a failure with no words of its own still has
// to read as a failure.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { say } from "../../web/src/app/dom.js";

// The smallest document say() touches: a report inside something that can be
// put away, found by id, carrying text and a class. A real DOM would prove no
// more here and would mean a dependency in a project that has none.
//
// Text and class coerce what they are given to a string, because that is the
// step a browser takes and the reason `undefined` reaches the reader as a
// word. A plain object field would hide the very bug under test.
function fakeElement(id, parentElement = null) {
  let text = "";
  let name = "";

  return {
    id,
    parentElement,
    hidden: false,
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = String(value);
    },
    get className() {
      return name;
    },
    set className(value) {
      name = String(value);
    },
  };
}

// The overlay each report lives inside, mirroring the page: `hidden` sits on
// the overlay, never on the report.
function fakeDocument(ids) {
  const overlays = new Map(ids.map((id) => [id, fakeElement(`${id}-overlay`)]));
  const nodes = new Map(ids.map((id) => [id, fakeElement(id, overlays.get(id))]));

  return {
    nodes,
    put: (id, away) => {
      overlays.get(id).hidden = away;
    },
    getElementById: (id) => nodes.get(id) ?? null,
  };
}

// Every place the app has to report, including the ones only an overlay can
// see. Named here rather than imported so the test says the list itself.
const PLACES = ["status", "curtain-say", "celebrate-say", "confirm-say", "setup-say"];

describe("saying what went wrong", () => {
  let doc;
  let was;

  function withDocument(ids = PLACES) {
    was = globalThis.document;
    doc = fakeDocument(ids);
    globalThis.document = doc;
  }

  afterEach(() => {
    globalThis.document = was;
  });

  test("puts the failure everywhere it could be read, not only in the footer", () => {
    withDocument();

    say("that folder cannot be reached", "error");

    for (const id of PLACES) {
      assert.equal(doc.nodes.get(id).textContent, "that folder cannot be reached", id);
      assert.equal(doc.nodes.get(id).className, "error", id);
    }
  });

  test("leaves nothing behind in an overlay that is not up", () => {
    withDocument();

    // The settings panel is open and the confirmation sheet is not, which is
    // the ordinary case: one thing is in front of the reader at a time.
    doc.put("confirm-say", true);
    say("that folder cannot be reached", "error");

    assert.equal(doc.nodes.get("setup-say").textContent, "that folder cannot be reached");
    assert.equal(doc.nodes.get("confirm-say").textContent, "");
    assert.equal(doc.nodes.get("confirm-say").className, "");
  });

  test("says nothing anywhere when there is nothing to report", () => {
    withDocument();
    say("that folder cannot be reached", "error");

    say("", "");

    for (const id of PLACES) {
      assert.equal(doc.nodes.get(id).textContent, "", id);
      assert.equal(doc.nodes.get(id).className, "", id);
    }
  });

  test("still reads as a failure when what was thrown had no message", () => {
    withDocument();

    // A thrown string, or anything else that is not an Error: `.message` is
    // undefined, and the reader used to be shown the word "undefined".
    say(undefined, "error");

    assert.equal(doc.nodes.get("status").textContent, "something went wrong");
    assert.equal(doc.nodes.get("status").className, "error");
  });

  test("never shows the reader the word undefined", () => {
    withDocument();

    for (const thrown of [undefined, null, {}]) {
      say(thrown, "error");

      for (const id of PLACES) {
        assert.equal(doc.nodes.get(id).textContent, "something went wrong", id);
      }
    }
  });

  test("works on a page that has only some of those places", () => {
    withDocument(["status"]);

    say("boom", "error");

    assert.equal(doc.nodes.get("status").textContent, "boom");
  });
});
