// The board keeping its place across a redraw.
//
// A redraw is whole: drawBoard builds the columns afresh every time. A chat
// with an agent asks for one on every line it streams, so a board that did not
// carry its scroll offsets across snapped back to the first column, and each
// column to its top, every few seconds while the agent worked.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawBoard } from "../../web/src/app/board.js";

// The smallest document the board draws in: class lookups walk the tree.
function fakeDocument() {
  const make = (tag) => {
    const node = {
      tag,
      id: "",
      className: "",
      textContent: "",
      hidden: false,
      dataset: {},
      children: [],
      scrollLeft: 0,
      scrollTop: 0,
      classList: { toggle() {} },
      setAttribute() {},
      addEventListener() {},
      append(...nodes) {
        node.children.push(...nodes);
      },
      replaceChildren(...nodes) {
        node.children = nodes;
      },
      querySelectorAll(selector) {
        const name = selector.replace(/^\./, "");
        const found = [];
        const walk = (at) => {
          for (const child of at.children) {
            if (child.className.split(" ").includes(name)) found.push(child);
            walk(child);
          }
        };

        walk(node);

        return found;
      },
      querySelector(selector) {
        return node.querySelectorAll(selector)[0] || null;
      },
    };

    return node;
  };

  const ids = {};

  return {
    createElement: make,
    getElementById: (id) => (ids[id] ||= make("div")),
    querySelector: () => (ids.main ||= make("main")),
  };
}

const entry = (key, flags) => ({ key, owner: "acme", repo: "shop", number: 1, title: key, draft: {}, ...flags });

const app = {
  board: true,
  boardOpen: new Set(),
  boardChat: null,
  queue: () => [entry("a#1", { isReady: true }), entry("a#2", { isDrafting: true })],
  dismissed: () => [],
};

describe("redrawing the board", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("keeps it scrolled where the reader left it", () => {
    globalThis.document = fakeDocument();
    drawBoard(app);

    const board = document.getElementById("board");
    const ready = () => board.querySelectorAll(".board-column").find((column) => column.dataset.state === "ready");

    board.querySelector(".board-columns").scrollLeft = 300;
    ready().scrollTop = 120;

    drawBoard(app);

    assert.equal(board.querySelector(".board-columns").scrollLeft, 300);
    assert.equal(ready().scrollTop, 120);
  });
});
