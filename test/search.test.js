// Finding an entry on the queue by what the reader remembers of it.
//
// The reader most often remembers the number, so a number puts the exact match
// first, then the numbers that start with it, then any text that holds it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { searchQueue } from "../web/src/queries/search.js";

const entry = (number, title, extra = {}) => ({
  owner: "org",
  repo: "app",
  number,
  title,
  author: "ana",
  ...extra,
});

const queue = [
  entry(1234, "Totals wrong on export"),
  entry(12, "Login loops"),
  entry(7, "Fix issue 12 in the parser", { repo: "api" }),
  entry(120, "Dark mode"),
];

const numbers = (entries) => entries.map((found) => found.number);

describe("searching the queue", () => {
  test("lists everything, in queue order, before anything is typed", () => {
    assert.deepEqual(numbers(searchQueue(queue, "  ")), [1234, 12, 7, 120]);
  });

  test("puts the exact number first, then numbers that start with it, then text", () => {
    assert.deepEqual(numbers(searchQueue(queue, "12")), [12, 1234, 120, 7]);
  });

  test("reads a leading # as part of the number", () => {
    assert.deepEqual(numbers(searchQueue(queue, "#7")), [7]);
  });

  test("matches every word of the text, in any case, across title, repo and author", () => {
    assert.deepEqual(numbers(searchQueue(queue, "API parser")), [7]);
    assert.deepEqual(numbers(searchQueue(queue, "org/app#120")), [120]);
    assert.deepEqual(numbers(searchQueue(queue, "nothing like this")), []);
  });
});
