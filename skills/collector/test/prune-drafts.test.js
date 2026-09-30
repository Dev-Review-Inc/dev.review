import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  finishedPulls,
  resolutions,
  commentPrefix,
  parseEventLines,
  readEvents,
  pruneDrafts,
  draftedKeys,
  pruneSettled,
} from "../prune-drafts.js";

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

// ---- resolutions: the same fold, keeping when and how each pull ended

test("a resolution carries its action and time", () => {
  const resolved = resolutions([event("org/app#1", "post", 100)]);
  assert.deepStrictEqual(resolved.get("org/app#1"), { action: "post", time: 100 });
});

test("a dismissal later restored resolves nothing", () => {
  const resolved = resolutions([
    event("org/app#1", "dismiss", 100),
    event("org/app#1", "restore", 200),
  ]);
  assert.strictEqual(resolved.has("org/app#1"), false);
});

test("the latest terminal event is the resolution", () => {
  const resolved = resolutions([
    event("org/app#1", "dismiss", 100),
    event("org/app#1", "restore", 200),
    event("org/app#1", "dismiss", 300),
  ]);
  assert.deepStrictEqual(resolved.get("org/app#1"), { action: "dismiss", time: 300 });
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

// ---- draftedKeys: the drafts on disk, identified by their own review.json

function writeDraft(draftsDir, folder, { owner, repo, number }) {
  const dir = path.join(draftsDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "review.json"), JSON.stringify({ owner, repo, number }));
  return dir;
}

test("reads each draft's review.json for its identity", () => {
  const { draftsDir } = tempSource();
  writeDraft(draftsDir, "Dev-Review-Inc--dev.review-9", { owner: "Dev-Review-Inc", repo: "dev.review", number: 9 });
  writeDraft(draftsDir, "org--app-1", { owner: "org", repo: "app", number: 1 });

  assert.deepStrictEqual(
    [...draftedKeys(draftsDir).keys()].sort(),
    ["Dev-Review-Inc/dev.review#9", "org/app#1"],
  );
});

test("a draft folder without a readable review.json has no key", () => {
  const { draftsDir } = tempSource();
  fs.mkdirSync(path.join(draftsDir, "org--app-1"), { recursive: true });
  fs.writeFileSync(path.join(draftsDir, "org--app-1", "review.json"), "not json");
  fs.mkdirSync(path.join(draftsDir, "org--app-2"), { recursive: true });

  assert.deepStrictEqual([...draftedKeys(draftsDir).keys()], []);
});

// ---- pruneSettled: drafts whose pull request or issue is settled upstream

test("deletes a draft whose item is closed upstream", () => {
  const { draftsDir } = tempSource();
  const dir = writeDraft(draftsDir, "org--app-1", { owner: "org", repo: "app", number: 1 });

  const { pruned, failed } = pruneSettled(draftsDir, () => "closed");

  assert.deepStrictEqual(pruned, ["org/app#1"]);
  assert.deepStrictEqual(failed, []);
  assert.strictEqual(fs.existsSync(dir), false);
});

test("leaves a draft alone while its item is open upstream", () => {
  const { draftsDir } = tempSource();
  const dir = writeDraft(draftsDir, "org--app-1", { owner: "org", repo: "app", number: 1 });

  const { pruned } = pruneSettled(draftsDir, () => "open");

  assert.deepStrictEqual(pruned, []);
  assert.strictEqual(fs.existsSync(dir), true);
});

test("a state that cannot be read prunes nothing for that key, and is reported", () => {
  const { draftsDir } = tempSource();
  const dir = writeDraft(draftsDir, "org--app-1", { owner: "org", repo: "app", number: 1 });
  writeDraft(draftsDir, "org--app-2", { owner: "org", repo: "app", number: 2 });

  const { pruned, failed } = pruneSettled(draftsDir, (key) => {
    if (key === "org/app#1") throw new Error("network down");
    return "closed";
  });

  assert.deepStrictEqual(pruned, ["org/app#2"]);
  assert.deepStrictEqual(failed, [{ key: "org/app#1", error: "network down" }]);
  assert.strictEqual(fs.existsSync(dir), true);
});

test("the CLI answers even when invoked through a symlink", () => {
  // The installed skill symlinks into this repository, so argv[1] and the
  // module's resolved filename differ. The CLI must still run.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reviewer-link-"));
  const link = path.join(root, "prune-drafts.js");
  fs.symlinkSync(path.join(import.meta.dirname, "..", "prune-drafts.js"), link);

  const result = spawnSync(process.execPath, [link], { encoding: "utf8" });

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /usage/);
});

test("asks upstream once per drafted key, and only for drafted keys", () => {
  const { draftsDir } = tempSource();
  writeDraft(draftsDir, "org--app-1", { owner: "org", repo: "app", number: 1 });
  const asked = [];

  pruneSettled(draftsDir, (key) => {
    asked.push(key);
    return "open";
  });

  assert.deepStrictEqual(asked, ["org/app#1"]);
});

// ---- redrafts: a pull dismissed, moved, and drafted again

function writeStamped(draftsDir, folder, review) {
  fs.mkdirSync(path.join(draftsDir, folder), { recursive: true });
  fs.writeFileSync(path.join(draftsDir, folder, "review.json"), JSON.stringify(review));
}

test("spares a draft written after its pull's dismissal", () => {
  const { draftsDir, eventsDir } = tempSource();
  writeStamped(draftsDir, "org--app-1", { draftedAt: new Date(500).toISOString() });
  writeLog(eventsDir, "device-a", [event("org/app#1", "dismiss", 100)]);

  const pruned = pruneDrafts(draftsDir);

  assert.deepStrictEqual(pruned, []);
  assert.strictEqual(fs.existsSync(path.join(draftsDir, "org--app-1")), true);
});

test("spares a draft whose finishedAt alone postdates the resolution", () => {
  const { draftsDir, eventsDir } = tempSource();
  writeStamped(draftsDir, "org--app-1", { draftedAt: new Date(50).toISOString(), finishedAt: new Date(500).toISOString() });
  writeLog(eventsDir, "device-a", [event("org/app#1", "post", 100)]);

  const pruned = pruneDrafts(draftsDir);

  assert.deepStrictEqual(pruned, []);
  assert.strictEqual(fs.existsSync(path.join(draftsDir, "org--app-1")), true);
});

test("deletes a draft written before its pull's dismissal", () => {
  const { draftsDir, eventsDir } = tempSource();
  writeStamped(draftsDir, "org--app-1", { draftedAt: new Date(50).toISOString(), finishedAt: new Date(60).toISOString() });
  writeLog(eventsDir, "device-a", [event("org/app#1", "dismiss", 100)]);

  const pruned = pruneDrafts(draftsDir);

  assert.deepStrictEqual(pruned, ["org/app#1"]);
  assert.strictEqual(fs.existsSync(path.join(draftsDir, "org--app-1")), false);
});

test("deletes a draft whose review.json carries no parsable timestamp", () => {
  const { draftsDir, eventsDir } = tempSource();
  writeStamped(draftsDir, "org--app-1", { draftedAt: "not a date" });
  writeLog(eventsDir, "device-a", [event("org/app#1", "dismiss", 100)]);

  assert.deepStrictEqual(pruneDrafts(draftsDir), ["org/app#1"]);
});

// ---- commentPrefix: the reader's standing prefix, latest event wins

const setPrefix = (prefix, time) => ({
  collection: "preferences",
  objectId: "reading",
  action: "setCommentPrefix",
  data: { prefix },
  time,
});

test("commentPrefix is empty when the log has no prefix event", () => {
  assert.equal(commentPrefix([]), "");
  assert.equal(commentPrefix([event("org/app#1", "post", 100)]), "");
});

test("commentPrefix takes the latest prefix by time, whatever the order", () => {
  assert.equal(commentPrefix([setPrefix("new", 200), setPrefix("old", 100)]), "new");
});

test("commentPrefix reads an empty latest prefix as none", () => {
  assert.equal(commentPrefix([setPrefix("old", 100), setPrefix("", 200)]), "");
});

test("commentPrefix ignores malformed events and non-string prefixes", () => {
  const events = [
    setPrefix("kept", 100),
    null,
    "junk",
    { ...setPrefix("no time", 0), time: "300" },
    { ...setPrefix("x", 400), data: { prefix: 5 } },
    { ...setPrefix("x", 500), data: null },
    { ...setPrefix("wrong object", 600), objectId: "other" },
    { ...setPrefix("wrong collection", 700), collection: "pulls" },
  ];

  assert.equal(commentPrefix(events), "kept");
});
