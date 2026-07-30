import test from "node:test";
import assert from "node:assert";

import { parsePatch } from "../web/src/domain/diff.js";

const PATCH = `@@ -1,4 +1,5 @@
 module Totals
-  class Error < StandardError
+  module Error
+    class TemporaryError < Totals::Error::TemporaryError; end
   end
 end`;

// kinds returns each line's kind, which is what the gutter and colour key off.
const kinds = (patch) => parsePatch(patch).flatMap((hunk) => hunk.lines.map((line) => line.kind));

test("reads the hunk header", () => {
  const [hunk] = parsePatch(PATCH);

  assert.strictEqual(hunk.header, "@@ -1,4 +1,5 @@");
  assert.strictEqual(hunk.oldStart, 1);
  assert.strictEqual(hunk.newStart, 1);
});

test("classifies each line", () => {
  assert.deepStrictEqual(kinds(PATCH), ["context", "del", "add", "add", "context", "context"]);
});

test("numbers context lines on both sides", () => {
  const [first] = parsePatch(PATCH)[0].lines;

  assert.strictEqual(first.oldLine, 1);
  assert.strictEqual(first.newLine, 1);
});

test("numbers a removed line only on the old side", () => {
  const removed = parsePatch(PATCH)[0].lines[1];

  assert.strictEqual(removed.oldLine, 2);
  assert.strictEqual(removed.newLine, null);
});

test("numbers an added line only on the new side", () => {
  const added = parsePatch(PATCH)[0].lines[2];

  assert.strictEqual(added.oldLine, null);
  assert.strictEqual(added.newLine, 2);
});

test("keeps counting correctly after an imbalanced hunk", () => {
  const lines = parsePatch(PATCH)[0].lines;
  const last = lines[lines.length - 1];

  // One line removed and two added, so the new side has run one ahead.
  assert.strictEqual(last.oldLine, 4);
  assert.strictEqual(last.newLine, 5);
});

test("strips the marker but keeps the line's own leading space", () => {
  const [hunk] = parsePatch("@@ -1,1 +1,1 @@\n+    indented");

  assert.strictEqual(hunk.lines[0].text, "    indented");
});

test("reads several hunks", () => {
  const hunks = parsePatch("@@ -1,1 +1,1 @@\n context\n@@ -40,1 +41,1 @@\n other");

  assert.strictEqual(hunks.length, 2);
  assert.strictEqual(hunks[1].oldStart, 40);
  assert.strictEqual(hunks[1].newStart, 41);
});

test("reads a hunk header that omits its line count", () => {
  const [hunk] = parsePatch("@@ -1 +1 @@\n context");

  assert.strictEqual(hunk.oldStart, 1);
  assert.strictEqual(hunk.newStart, 1);
});

test("keeps the no-newline marker out of the line numbering", () => {
  const [hunk] = parsePatch("@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file");

  assert.deepStrictEqual(
    hunk.lines.map((line) => line.kind),
    ["del", "add"],
  );
});

test("has no hunks for a file GitHub sent no patch for", () => {
  assert.deepStrictEqual(parsePatch(undefined), []);
  assert.deepStrictEqual(parsePatch(""), []);
});

test("ignores anything before the first hunk header", () => {
  assert.strictEqual(parsePatch("diff --git a/x b/x\n@@ -1,1 +1,1 @@\n context").length, 1);
});
