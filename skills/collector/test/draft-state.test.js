import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { draftState, STALE_AFTER_MS } from "../draft-state.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const OLD = new Date(NOW - STALE_AFTER_MS - 1000);
const FRESH = new Date(NOW - 1000);

function folder(files, touched) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-state-"));

  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    fs.utimesSync(file, touched[name] || OLD, touched[name] || OLD);
  }

  return dir;
}

const unfinished = JSON.stringify({ schema: 3, progress: { note: "QA" } });
const finished = JSON.stringify({ schema: 3, finishedAt: "2026-10-01T00:00:00Z" });

test("no folder is no draft", () => {
  assert.strictEqual(draftState(path.join(os.tmpdir(), "draft-state-missing"), NOW), "none");
});

test("a folder with media but no review.json is no draft", () => {
  const dir = folder({ "qa.mp4": "", "frames/1.png": "" }, {});
  assert.strictEqual(draftState(dir, NOW), "none");
});

test("a finished draft stays finished however old it is", () => {
  const dir = folder({ "review.json": finished }, {});
  assert.strictEqual(draftState(dir, NOW), "finished");
});

test("an unfinished claim written just now is live", () => {
  const dir = folder({ "review.json": unfinished }, { "review.json": FRESH });
  assert.strictEqual(draftState(dir, NOW), "live");
});

test("an unfinished claim is live while QA is still writing beside it", () => {
  const dir = folder(
    { "review.json": unfinished, "frames/3.png": "" },
    { "frames/3.png": FRESH },
  );
  assert.strictEqual(draftState(dir, NOW), "live");
});

test("an unfinished claim nothing has touched in half an hour is stale", () => {
  const dir = folder({ "review.json": unfinished, "frames/1.png": "" }, {});
  assert.strictEqual(draftState(dir, NOW), "stale");
});

test("a review.json cut off mid-write counts as unfinished", () => {
  const dir = folder({ "review.json": '{"schema": 3, "progress": {"no' }, {});
  assert.strictEqual(draftState(dir, NOW), "stale");
});
