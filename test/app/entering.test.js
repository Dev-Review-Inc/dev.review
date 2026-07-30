// Whether the front door is the pitch or the interface.
//
// The site takes the root and the app sits under /app/. A reader who has been
// through the pitch once and attached storage of their own is not there to read
// it again, so the root sends them on. Two things make that dangerous rather
// than helpful, and both are pinned here: the homepage frames the demo, which
// attaches sample storage to every visitor, and a reader who genuinely wants
// the pitch back must be able to reach it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { KEY, remember, remembered, entering } from "../../web/src/app/theirs.js";

function aStore(items = {}) {
  return {
    items,
    getItem: (name) => (name in items ? items[name] : null),
    setItem: (name, value) => {
      items[name] = String(value);
    },
  };
}

describe("remembering that the reader brought their own", () => {
  test("knows nothing about a reader who has attached nothing", () => {
    assert.equal(remembered(aStore()), false);
  });

  test("remembers once they have", () => {
    const store = aStore();

    remember(store);

    assert.equal(remembered(store), true);
    assert.equal(store.items[KEY], "1");
  });

  // A browser with storage disabled throws on the way in rather than returning
  // nothing. The pitch is the safe answer there, so this must not be the thing
  // that takes the site down.
  test("treats storage it cannot read as a reader it has not met", () => {
    const hostile = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };

    assert.equal(remembered(hostile), false);
    assert.doesNotThrow(() => remember(hostile));
  });
});

describe("what the root does about it", () => {
  const known = aStore({ [KEY]: "1" });

  test("sends a reader with their own storage to the interface", () => {
    assert.equal(entering(known, { search: "", top: true }), "/app/");
  });

  test("leaves a first-time reader on the pitch", () => {
    assert.equal(entering(aStore(), { search: "", top: true }), "");
  });

  // The homepage pins the interface into itself as a frame. If the framed copy
  // followed this it would load the interface into the frame instead of the
  // demo, and a frame that redirects its own parent would take the pitch off
  // the screen of someone who came to read it.
  test("never acts inside a frame", () => {
    assert.equal(entering(known, { search: "", top: false }), "");
  });

  // Otherwise the pitch becomes unreachable for exactly the people who have
  // most reason to link to it.
  test("stays put when the reader asked for the pitch", () => {
    assert.equal(entering(known, { search: "?site", top: true }), "");
    assert.equal(entering(known, { search: "?site=1&utm=x", top: true }), "");
  });
});
