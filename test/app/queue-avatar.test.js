// Who opened the work, on a queue row.
//
// Initials on an accent circle made every row look the same, which is the one
// thing a reader scanning the queue for their own pull requests needs to tell
// apart. The picture is drawn when the destination can name one, and the row
// falls back to the initials whenever it cannot: a draft with no author, a
// destination that offers no pictures, and an image that does not load are all
// ordinary here, because the app reads from drafts and is read offline.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { queueRow } from "../../web/src/app/header.js";

function stub(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    src: "",
    alt: undefined,
    loading: "",
    decoding: "",
    parent: null,
    children: [],
    listeners: {},
    style: { setProperty() {} },
    append(...nodes) {
      for (const node of nodes) node.parent = this;
      this.children.push(...nodes);
    },
    replaceWith(node) {
      const at = this.parent.children.indexOf(this);

      node.parent = this.parent;
      this.parent.children[at] = node;
      this.parent = null;
    },
    addEventListener(name, run) {
      this.listeners[name] = run;
    },
    setAttribute() {},
    removeAttribute() {},
  };
}

function fakeDocument() {
  return { createElement: (tag) => stub(tag), createTextNode: (text) => ({ tag: "#text", textContent: text, children: [] }) };
}

const entry = {
  key: "o/r#7",
  title: "A change",
  owner: "o",
  repo: "r",
  number: 7,
  author: "dallasread",
  updatedAt: "2026-07-29T15:41:10Z",
  isReady: false,
  postedAt: null,
  draft: null,
};

function avatars(node) {
  return [
    ...(node.className === "avatar" ? [node] : []),
    ...(node.children || []).flatMap(avatars),
  ];
}

function rowFor(app, over = {}) {
  globalThis.document = fakeDocument();

  return queueRow(app, { ...entry, ...over });
}

const withPicture = { destination: { avatarFor: () => "https://github.com/dallasread.png?size=48" } };

describe("a queue row's author", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("is not drawn at all when the draft names nobody", () => {
    assert.deepEqual(avatars(rowFor(withPicture, { author: "" })), []);
  });

  test("wears the picture the destination names", () => {
    const [avatar] = avatars(rowFor(withPicture));

    assert.equal(avatar.tag, "img");
    assert.equal(avatar.src, "https://github.com/dallasread.png?size=48");
  });

  test("leaves the picture unspoken, because the name is already beside it", () => {
    const [avatar] = avatars(rowFor(withPicture));

    assert.equal(avatar.alt, "");
    assert.equal(avatar.loading, "lazy");
    assert.equal(avatar.decoding, "async");
  });

  test("falls back to initials when the destination names no picture", () => {
    const [avatar] = avatars(rowFor({ destination: { avatarFor: () => "" } }));

    assert.equal(avatar.tag, "span");
    assert.equal(avatar.textContent, "DA");
  });

  test("falls back to initials when the destination cannot name pictures at all", () => {
    const [avatar] = avatars(rowFor({}));

    assert.equal(avatar.tag, "span");
    assert.equal(avatar.textContent, "DA");
  });

  test("puts the initials back in place when the picture does not load", () => {
    const row = rowFor(withPicture);
    const [picture] = avatars(row);

    picture.listeners.error();

    const [avatar] = avatars(row);

    assert.equal(avatar.tag, "span");
    assert.equal(avatar.textContent, "DA");
  });
});
