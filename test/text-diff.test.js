import test from "node:test";
import assert from "node:assert";

import { diffText, applyHunks } from "../web/src/domain/text-diff.js";

const OLD = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].join("\n");
const NEW = ["one", "two", "3", "four", "five", "six", "seven", "eight", "nine", "ten", "11", "twelve"].join("\n");

test("identical texts produce no hunks", () => {
  assert.deepStrictEqual(diffText("a\nb", "a\nb"), []);
});

test("a changed line becomes a del/add pair inside three lines of context", () => {
  const [hunk] = diffText(OLD, ["one", "two", "3", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].join("\n"));

  assert.deepStrictEqual(
    hunk.lines.map((line) => line.kind),
    ["context", "context", "del", "add", "context", "context", "context"],
  );
  assert.strictEqual(hunk.lines[2].text, "three");
  assert.strictEqual(hunk.lines[3].text, "3");
});

test("lines carry both sides' numbers the way parsePatch does", () => {
  const [hunk] = diffText(OLD, ["one", "two", "3", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].join("\n"));

  assert.deepStrictEqual(hunk.lines[0], { kind: "context", oldLine: 1, newLine: 1, text: "one" });
  assert.deepStrictEqual(hunk.lines[2], { kind: "del", oldLine: 3, newLine: null, text: "three" });
  assert.deepStrictEqual(hunk.lines[3], { kind: "add", oldLine: null, newLine: 3, text: "3" });
});

test("header carries starts and counts in @@ -a,b +c,d @@ form", () => {
  const [hunk] = diffText(OLD, ["one", "two", "3", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].join("\n"));

  assert.strictEqual(hunk.header, "@@ -1,6 +1,6 @@");
  assert.strictEqual(hunk.oldStart, 1);
  assert.strictEqual(hunk.newStart, 1);
});

test("distant edits split into separate hunks", () => {
  const hunks = diffText(OLD, NEW);

  assert.strictEqual(hunks.length, 2);
  assert.strictEqual(hunks[1].oldStart, 8);
  assert.strictEqual(hunks[1].newStart, 8);
  // Only "twelve" is left to trail the change, so the count is five, not six.
  assert.strictEqual(hunks[1].header, "@@ -8,5 +8,5 @@");
});

test("nearby edits merge into one hunk", () => {
  const hunks = diffText(OLD, ["one", "two", "3", "four", "5", "six", "seven", "eight", "nine", "ten"].join("\n"));

  assert.strictEqual(hunks.length, 1);
});

test("empty to something is a pure addition", () => {
  const [hunk] = diffText("", "a\nb");

  assert.strictEqual(hunk.header, "@@ -0,0 +1,2 @@");
  assert.deepStrictEqual(
    hunk.lines.map((line) => line.kind),
    ["add", "add"],
  );
});

test("something to empty is a pure deletion", () => {
  const [hunk] = diffText("a\nb", "");

  assert.strictEqual(hunk.header, "@@ -1,2 +0,0 @@");
  assert.deepStrictEqual(
    hunk.lines.map((line) => line.kind),
    ["del", "del"],
  );
});

test("a trailing newline difference is a real hunk", () => {
  const hunks = diffText("a\nb", "a\nb\n");

  assert.strictEqual(hunks.length, 1);
  assert.strictEqual(applyHunks("a\nb", hunks, []), "a\nb\n");
});

test("an edit keeps its id when the text above it grows", () => {
  const before = diffText("intro\nkeep\nold line\ntail", "intro\nkeep\nnew line\ntail");
  const after = diffText("intro\nadded\nmore\nkeep\nold line\ntail", "intro\nadded\nmore\nkeep\nnew line\ntail");

  assert.strictEqual(before[0].id, after[0].id);
});

test("identical edits in one diff get distinct ids", () => {
  const hunks = diffText(
    ["old", "a", "b", "c", "d", "e", "f", "g", "old", "z"].join("\n"),
    ["new", "a", "b", "c", "d", "e", "f", "g", "new", "z"].join("\n"),
  );

  assert.strictEqual(hunks.length, 2);
  assert.notStrictEqual(hunks[0].id, hunks[1].id);
});

// Round-tripping is the whole contract: keep every hunk and you have newText.
const CASES = [
  ["", ""],
  ["", "a\nb\nc"],
  ["a\nb\nc", ""],
  ["a\nb", "a\nb\n"],
  ["a\nb\n", "a\nb"],
  [OLD, NEW],
  ["# Title\n\nBody text.\n", "# Title\n\nRewritten body.\n\nExtra section.\n"],
  ["same\nsame\nsame", "same\nsame\nsame\nsame"],
  ["x", "totally\ndifferent\nthing"],
];

test("applying every hunk reproduces the new text", () => {
  for (const [a, b] of CASES) {
    assert.strictEqual(applyHunks(a, diffText(a, b), []), b);
  }
});

test("rejecting every hunk returns the old text", () => {
  for (const [a, b] of CASES) {
    const hunks = diffText(a, b);
    assert.strictEqual(applyHunks(a, hunks, hunks.map((hunk) => hunk.id)), a);
  }
});

test("rejecting one hunk keeps the other hunk's change", () => {
  const hunks = diffText(OLD, NEW);
  const kept = applyHunks(OLD, hunks, [hunks[0].id]);

  assert.strictEqual(kept, ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "11", "twelve"].join("\n"));
});
