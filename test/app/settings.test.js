// The settings panel's own arithmetic: what a nav row says a source resolves
// to, when a group header carries a count, what colour that count wears, when
// a form counts as dirty, and what the one status line under the fields says.
//
// All pure, all tested apart from the DOM, because each is a sentence the
// reader acts on and a wrong sentence here reads as a broken source.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  attention,
  destinationDirty,
  resolvedSource,
  sourceDirty,
  statusLine,
  folderWork,
} from "../../web/src/app/header.js";

describe("what a nav row resolves a source to", () => {
  test("an s3 source is its url, with the prefix only when there is one", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "s3", bucket: "notes", prefix: "team/" } }, ""),
      "s3://notes/team",
    );
    assert.equal(resolvedSource({ adapter: { type: "s3", bucket: "notes" } }, ""), "s3://notes");
  });

  test("a desktop source is its root path", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "tauri", root: "/home/d/notes" } }, ""),
      "/home/d/notes",
    );
  });

  test("a browser folder is the remembered folder's name, or an honest shrug", () => {
    assert.equal(resolvedSource({ adapter: { type: "filesystem" } }, "org"), "org/");
    assert.equal(
      resolvedSource({ adapter: { type: "filesystem" } }, ""),
      "folder on this computer",
    );
  });
});

describe("the count a group header carries", () => {
  test("counts only the rows needing attention", () => {
    const { count } = attention([{ state: "ok" }, { state: "warn" }, { state: "broken" }, null]);

    assert.equal(count, 2);
  });

  test("wears the worst colour present", () => {
    assert.equal(attention([{ state: "warn" }]).tone, "warn");
    assert.equal(attention([{ state: "warn" }, { state: "broken" }]).tone, "bad");
    assert.equal(attention([{ state: "ok" }, null]).tone, "");
  });
});

describe("when the source form counts as dirty", () => {
  const stored = { name: "Work", adapter: { type: "s3", bucket: "notes", region: "us-east-1" } };
  const fields = [
    { key: "bucket" },
    { key: "region" },
    { key: "accessKeyId", secret: true },
  ];

  function setup(overrides = {}) {
    return {
      editing: stored,
      name: "Work",
      type: "s3",
      values: { bucket: "notes", region: "us-east-1" },
      handle: null,
      ...overrides,
    };
  }

  test("clean when everything reads back as stored", () => {
    assert.equal(sourceDirty(setup(), fields), false);
  });

  test("adding is never dirty, because there is nothing to differ from", () => {
    assert.equal(sourceDirty(setup({ editing: null }), fields), false);
  });

  test("a changed name, value, backend or a fresh folder each make it dirty", () => {
    assert.equal(sourceDirty(setup({ name: "Wrok" }), fields), true);
    assert.equal(sourceDirty(setup({ values: { bucket: "typo", region: "us-east-1" } }), fields), true);
    assert.equal(sourceDirty(setup({ type: "filesystem" }), fields), true);
    assert.equal(sourceDirty(setup({ handle: { name: "notes" } }), fields), true);
  });

  test("a typed secret is dirty; a blank secret box means unchanged", () => {
    const typed = setup({ values: { bucket: "notes", region: "us-east-1", accessKeyId: "AK" } });

    assert.equal(sourceDirty(typed, fields), true);
    assert.equal(
      sourceDirty(setup({ values: { bucket: "notes", region: "us-east-1", accessKeyId: "" } }), fields),
      false,
    );
  });
});

describe("when the destination form counts as dirty", () => {
  const stored = { label: "GitHub", type: "github" };

  test("clean when the label reads back and no token was typed", () => {
    assert.equal(destinationDirty({ editing: stored, label: "GitHub", values: {} }), false);
    assert.equal(destinationDirty({ editing: null, label: "x", values: { token: "t" } }), false);
  });

  test("a changed label or a typed token makes it dirty", () => {
    assert.equal(destinationDirty({ editing: stored, label: "Work", values: {} }), true);
    assert.equal(destinationDirty({ editing: stored, label: "GitHub", values: { token: "t" } }), true);
  });
});

describe("the status line under the fields", () => {
  test("says nothing before the source has been looked at", () => {
    assert.deepEqual(statusLine(null, "drafts/"), { text: "", tone: "" });
  });

  test("a healthy source quotes what it reads, how much, and when", () => {
    const { text, tone } = statusLine(
      { state: "ok", reason: "", drafts: 14, at: Date.now() },
      "drafts/",
    );

    assert.equal(text, "reads drafts/ · 14 drafts · checked 0m ago");
    assert.equal(tone, "");
  });

  test("one draft is one draft", () => {
    const { text } = statusLine({ state: "ok", reason: "", drafts: 1, at: Date.now() }, "drafts/");

    assert.match(text, /1 draft ·/);
  });

  test("a warning or a break is the probe's own words, in its colour", () => {
    assert.deepEqual(statusLine({ state: "warn", reason: "No drafts are waiting here." }, "x"), {
      text: "No drafts are waiting here.",
      tone: "warn",
    });
    assert.deepEqual(statusLine({ state: "broken", reason: "denied" }, "x"), {
      text: "denied",
      tone: "bad",
    });
  });
});

describe("what the app does inside a source's folder", () => {
  const source = { adapter: { type: "filesystem" } };

  test("names the folder it is all relative to", () => {
    assert.equal(folderWork(source, "my", "ab12").at, "my/");
  });

  test("lists the drafts as read and never written", () => {
    const [drafts] = folderWork(source, "my", "ab12").does;

    assert.equal(drafts.path, "drafts/");
    assert.match(drafts.doing, /^read\b/);
    assert.match(drafts.doing, /never/);
  });

  test("names this device's own log, and says it is written", () => {
    const [, mine] = folderWork(source, "my", "ab12").does;

    assert.equal(mine.path, ".reviewer/events/ab12.jsonl");
    assert.match(mine.doing, /^written\b/);
  });

  test("lists the other devices' logs as read", () => {
    const [, , theirs] = folderWork(source, "my", "ab12").does;

    assert.equal(theirs.path, ".reviewer/events/");
    assert.match(theirs.doing, /^read\b/);
  });

  test("names a remote location the same way", () => {
    const bucket = { adapter: { type: "s3", bucket: "notes", prefix: "team/" } };

    assert.equal(folderWork(bucket, "", "ab12").at, "s3://notes/team/");
  });

  // The whole point is that it quotes real locations. A handle the browser has
  // forgotten leaves nothing to quote, so it says nothing.
  test("says nothing when the location cannot be named", () => {
    assert.equal(folderWork(source, "", "ab12"), null);
  });
});
