// The board: every pull request at once, laid out by where it has got to.
//
// The rule under test is that the board and the queue never disagree. A
// column is read off the same pullState flags the queue row reads, so a pull
// request the row calls stalled sits in the stalled column, and one the
// reader posted sits under posted however finished its draft is.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { boardColumns, findingsByKind, firstLine } from "../../web/src/app/board-layout.js";

// Shaped the way pullState hands entries over.
const entry = (key, flags = {}) => ({
  key,
  draft: {},
  isReady: false,
  isDrafting: false,
  isStalled: false,
  dismissedAt: null,
  postedAt: null,
  ...flags,
});

const keysIn = (columns, name) => columns.find((column) => column.key === name).entries.map((e) => e.key);

describe("laying the pull requests out by state", () => {
  const columns = boardColumns([
    entry("a#1", { isDrafting: true }),
    entry("a#2", { isStalled: true }),
    entry("a#3", { isReady: true }),
    entry("a#4", { isReady: true, dismissedAt: 1, postedAt: 1 }),
    entry("a#5", { isReady: true, dismissedAt: 1 }),
  ]);

  test("draws the columns in the order work moves through them", () => {
    assert.deepEqual(
      columns.map((column) => column.key),
      ["drafting", "stalled", "ready", "posted", "dismissed"],
    );
  });

  test("puts each pull request under the state the queue gives it", () => {
    assert.deepEqual(keysIn(columns, "drafting"), ["a#1"]);
    assert.deepEqual(keysIn(columns, "stalled"), ["a#2"]);
    assert.deepEqual(keysIn(columns, "ready"), ["a#3"]);
  });

  test("files a posted review under posted, not under the dismissal posting records", () => {
    assert.deepEqual(keysIn(columns, "posted"), ["a#4"]);
    assert.deepEqual(keysIn(columns, "dismissed"), ["a#5"]);
  });

  test("keeps an empty column, so the board's shape does not move under the reader", () => {
    assert.deepEqual(keysIn(boardColumns([]), "ready"), []);
  });

  test("gives one with no draft a column of its own rather than losing it", () => {
    assert.deepEqual(keysIn(boardColumns([entry("a#6", { draft: null })]), "not started"), ["a#6"]);
  });

  test("draws no not-started column when nothing is in it", () => {
    assert.equal(columns.some((column) => column.key === "not started"), false);
  });
});

describe("grouping a review's findings", () => {
  const findings = [{ id: "1", kind: "bug" }, { id: "2", kind: "question" }, { id: "3", kind: "bug" }, { id: "4" }];

  test("groups them by kind, in the order the agent first used each one", () => {
    assert.deepEqual(
      findingsByKind(findings).map((group) => [group.kind, group.findings.map((f) => f.id)]),
      [["bug", ["1", "3"]], ["question", ["2"]], ["", ["4"]]],
    );
  });

  test("has nothing to group when the draft has no findings", () => {
    assert.deepEqual(findingsByKind(undefined), []);
  });
});

describe("the line a finding card shows", () => {
  test("is the first line of the body with words on it", () => {
    assert.equal(firstLine("\n  The rescue never matches.  \nMore here."), "The rescue never matches.");
  });

  test("is empty for an empty body", () => {
    assert.equal(firstLine(""), "");
  });
});
