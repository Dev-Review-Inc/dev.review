import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { finishedPulls, parseEventLines, readEvents, pruneDrafts } from "../prune-drafts.js";

const event = (objectId, action, time, collection = "pulls") => ({ collection, objectId, action, time });

// ---- finishedPulls: the pure decision logic

test("a pull with only a post event is finished", () => {
  const finished = finishedPulls([event("org/app#1", "post", 100)]);
  assert.deepStrictEqual([...finished], ["org/app#1"]);
});

test("a pull with only a dismiss event is finished", () => {
  const finished = finishedPulls([event("org/app#1", "dismiss", 100)]);
  assert.deepStrictEqual([...finished], ["org/app#1"]);
});

test("a dismiss later restored is not finished", () => {
  const finished = finishedPulls([
    event("org/app#1", "dismiss", 100),
    event("org/app#1", "restore", 200),
  ]);
  assert.deepStrictEqual([...finished], []);
});

test("a restore later dismissed again is finished", () => {
  const finished = finishedPulls([
    event("org/app#1", "dismiss", 100),
    event("org/app#1", "restore", 200),
    event("org/app#1", "dismiss", 300),
  ]);
  assert.deepStrictEqual([...finished], ["org/app#1"]);
});

test("a pull with no pulls-collection events is not finished", () => {
  const finished = finishedPulls([event("org/app#1", "drop", 100, "findings")]);
  assert.deepStrictEqual([...finished], []);
});

test("ignores events for other collections when deciding a pull's state", () => {
  const finished = finishedPulls([
    event("org/app#1", "post", 100),
    event("org/app#1", "flagOnly", 500, "preferences"),
  ]);
  assert.deepStrictEqual([...finished], ["org/app#1"]);
});

test("events out of file order still resolve by time, not by position", () => {
  const finished = finishedPulls([
    event("org/app#1", "restore", 50),
    event("org/app#1", "dismiss", 10),
  ]);
  assert.deepStrictEqual([...finished], []);
});

// ---- parseEventLines: defensive against a partial or interrupted log

test("parses one event per line", () => {
  const text = `${JSON.stringify(event("org/app#1", "post", 1))}\n${JSON.stringify(event("org/app#2", "dismiss", 2))}`;
  assert.strictEqual(parseEventLines(text).length, 2);
});

test("drops a malformed line rather than failing the whole file", () => {
  const text = `${JSON.stringify(event("org/app#1", "post", 1))}\nnot json at all\n{"collection":"pulls"`;
  const parsed = parseEventLines(text);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].objectId, "org/app#1");
});

test("ignores blank lines", () => {
  const text = `${JSON.stringify(event("org/app#1", "post", 1))}\n\n\n`;
  assert.strictEqual(parseEventLines(text).length, 1);
});

// ---- readEvents: multiple device files under .reviewer/events/

function tempSource() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reviewer-source-"));
  const draftsDir = path.join(root, "drafts");
  const eventsDir = path.join(root, ".reviewer", "events");

  fs.mkdirSync(draftsDir, { recursive: true });
  fs.mkdirSync(eventsDir, { recursive: true });

  return { root, draftsDir, eventsDir };
}

function writeLog(eventsDir, device, events) {
  fs.writeFileSync(path.join(eventsDir, `${device}.jsonl`), events.map((e) => JSON.stringify(e)).join("\n"));
}

test("reads events from every device's log file", () => {
  const { draftsDir, eventsDir } = tempSource();
  writeLog(eventsDir, "device-a", [event("org/app#1", "post", 100)]);
  writeLog(eventsDir, "device-b", [event("org/app#2", "dismiss", 200)]);

  const events = readEvents(draftsDir);
  assert.deepStrictEqual(
    events.map((e) => e.objectId).sort(),
    ["org/app#1", "org/app#2"],
  );
});

test("a later event in a different device's file wins", () => {
  const { draftsDir, eventsDir } = tempSource();
  writeLog(eventsDir, "device-a", [event("org/app#1", "dismiss", 100)]);
  writeLog(eventsDir, "device-b", [event("org/app#1", "restore", 200)]);

  const finished = finishedPulls(readEvents(draftsDir));
  assert.deepStrictEqual([...finished], []);
});

test("returns nothing when there is no events directory yet", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reviewer-source-"));
  const draftsDir = path.join(root, "drafts");
  fs.mkdirSync(draftsDir, { recursive: true });

  assert.deepStrictEqual(readEvents(draftsDir), []);
});

// ---- pruneDrafts: end to end, deleting draft folders on disk

test("deletes a draft folder whose pull was posted", () => {
  const { draftsDir, eventsDir } = tempSource();
  fs.mkdirSync(path.join(draftsDir, "org--app-1"), { recursive: true });
  fs.writeFileSync(path.join(draftsDir, "org--app-1", "review.json"), "{}");
  fs.writeFileSync(path.join(draftsDir, "org--app-1", "qa.mp4"), "video");
  writeLog(eventsDir, "device-a", [event("org/app#1", "post", 100)]);

  const pruned = pruneDrafts(draftsDir);

  assert.deepStrictEqual(pruned, ["org/app#1"]);
  assert.strictEqual(fs.existsSync(path.join(draftsDir, "org--app-1")), false);
});

test("leaves a draft folder alone when its pull is still active", () => {
  const { draftsDir, eventsDir } = tempSource();
  fs.mkdirSync(path.join(draftsDir, "org--app-1"), { recursive: true });
  writeLog(eventsDir, "device-a", [
    event("org/app#1", "dismiss", 100),
    event("org/app#1", "restore", 200),
  ]);

  const pruned = pruneDrafts(draftsDir);

  assert.deepStrictEqual(pruned, []);
  assert.strictEqual(fs.existsSync(path.join(draftsDir, "org--app-1")), true);
});

test("skips a finished pull with no draft folder on disk, without error", () => {
  const { draftsDir, eventsDir } = tempSource();
  writeLog(eventsDir, "device-a", [event("org/app#1", "dismiss", 100)]);

  assert.deepStrictEqual(pruneDrafts(draftsDir), []);
});
