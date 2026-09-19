import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { post, SWEEP_LOG } from "../post.js";
import { readEvents, resolutions } from "../prune-drafts.js";

const KEY = "org/app#42";
const HEAD = "e612b1b0c0ffee00000000000000000000000000";
const NOW = 1_800_000_000_000;

const POST_RULE = { rules: [{ when: { author: "friend" }, then: "post" }] };

function draft(overrides = {}) {
  return {
    schema: 3,
    owner: "org",
    repo: "app",
    number: 42,
    verdict: "APPROVE",
    title: "Add a thing",
    url: "https://github.com/org/app/pull/42",
    author: "friend",
    comment: "Looks right.",
    reviewedAt: "e612b1b",
    findings: [
      { id: "a", path: "lib/a.rb", line: 3, body: "First." },
      { id: "b", path: "lib/b.rb", line: 9, body: "Second.", suggestion: "fixed" },
    ],
    draftedAt: "2026-09-18T10:00:00Z",
    finishedAt: "2026-09-18T10:05:00Z",
    ...overrides,
  };
}

function live(overrides = {}) {
  return {
    state: "open",
    draft: false,
    user: { login: "friend" },
    labels: [{ name: "enhancement" }],
    head: { sha: HEAD },
    ...overrides,
  };
}

// A source on disk: <root>/drafts, with the rules beside the drafts and the
// sync log one level up, as the app lays them out.
function source({ review = draft(), rules = POST_RULE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "post-"));
  const draftsDir = path.join(root, "drafts");
  const dir = path.join(draftsDir, "org--app-42");

  fs.mkdirSync(dir, { recursive: true });

  if (review !== null) {
    fs.writeFileSync(path.join(dir, "review.json"), typeof review === "string" ? review : JSON.stringify(review));
  }

  if (rules !== null) {
    fs.writeFileSync(path.join(draftsDir, "rules.json"), typeof rules === "string" ? rules : JSON.stringify(rules));
  }

  return { root, draftsDir, eventsDir: path.join(root, ".reviewer", "events") };
}

// A gh that answers the live pull request and the review post, and remembers
// everything it was asked.
function stubGh({ pull = live(), url = "https://github.com/org/app/pull/42#pullrequestreview-7" } = {}) {
  const calls = [];

  const gh = (args, stdin) => {
    calls.push({ args, stdin });

    if (args.includes("POST")) return JSON.stringify({ html_url: url });

    return JSON.stringify(pull);
  };

  gh.calls = calls;
  gh.posts = () => calls.filter((call) => call.args.includes("POST"));

  return gh;
}

function refusal(result, pattern, gh) {
  assert.equal(result.posted, undefined);
  assert.equal(result.refused.key !== undefined, true);
  assert.match(result.refused.reason, pattern);
  if (gh) assert.equal(gh.posts().length, 0);
}

function writeEvents(eventsDir, name, events) {
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(eventsDir, name), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

test("refuses a key it cannot parse", () => {
  const { draftsDir } = source();
  const gh = stubGh();

  refusal(post({ draftsDir, key: "org/app", gh, now: () => NOW }), /key/i, gh);
  refusal(post({ draftsDir, key: "../x/app#1", gh, now: () => NOW }), /key/i, gh);
  assert.equal(gh.calls.length, 0);
});

test("refuses when there is no draft", () => {
  const { draftsDir } = source({ review: null });
  const gh = stubGh();

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /no draft/i, gh);
  assert.equal(gh.calls.length, 0);
});

test("refuses a draft that is not JSON", () => {
  const { draftsDir } = source({ review: "{ nope" });
  const gh = stubGh();

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /unreadable/i, gh);
});

test("refuses an unfinished draft", () => {
  const { draftsDir } = source({ review: draft({ finishedAt: undefined }) });
  const gh = stubGh();

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /not finished/i, gh);
  assert.equal(gh.calls.length, 0);
});

test("refuses a verdict that is not a review event", () => {
  const { draftsDir } = source({ review: draft({ verdict: "LGTM" }) });
  const gh = stubGh();

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /LGTM/, gh);
  assert.equal(gh.calls.length, 0);
});

test("refuses when the rules will not load, saying why", () => {
  const { draftsDir } = source({ rules: "{ nope" });
  const gh = stubGh();

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /rules/i, gh);
  assert.equal(gh.calls.length, 0);
});

test("refuses a pull request that is no longer open", () => {
  const { draftsDir } = source();
  const gh = stubGh({ pull: live({ state: "closed" }) });

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /closed/i, gh);
});

test("refuses when the live author is not the draft's author", () => {
  const { draftsDir } = source();
  const gh = stubGh({ pull: live({ user: { login: "stranger" } }) });

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /author/i, gh);
});

test("matches the author without regard to case", () => {
  const { draftsDir } = source();
  const gh = stubGh({ pull: live({ user: { login: "Friend" } }) });

  assert.ok(post({ draftsDir, key: KEY, gh, now: () => NOW }).posted);
});

test("refuses a draft written against an older commit", () => {
  const { draftsDir } = source();
  const gh = stubGh({ pull: live({ head: { sha: "ffffffff00000000000000000000000000000000" } }) });

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /stale/i, gh);
});

test("refuses when the rules do not say post for the live facts", () => {
  const gh = stubGh();

  // No rule at all.
  refusal(post({ draftsDir: source({ rules: null }).draftsDir, key: KEY, gh, now: () => NOW }), /rules/i, gh);

  // A rule that posts approvals only, and a draft that requests changes.
  const approvals = source({
    review: draft({ verdict: "REQUEST_CHANGES" }),
    rules: { rules: [{ when: { author: "friend", verdict: "APPROVE" }, then: "post" }] },
  });

  refusal(post({ draftsDir: approvals.draftsDir, key: KEY, gh, now: () => NOW }), /rules/i, gh);
});

test("judges the rules on the live labels and draft flag", () => {
  const { draftsDir } = source({
    rules: {
      rules: [
        { when: { label: "wip" }, then: "skip" },
        { when: { author: "friend" }, then: "post" },
      ],
    },
  });
  const gh = stubGh({ pull: live({ labels: [{ name: "wip" }] }) });

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /skip/i, gh);
});

test("refuses a pull request the sync log says was already posted", () => {
  const { draftsDir, eventsDir } = source();
  const gh = stubGh();

  // The app's own pair: the dismiss is the latest word, the post is still there.
  writeEvents(eventsDir, "3f0c8a52-1111-4222-8333-444455556666.jsonl", [
    { collection: "pulls", objectId: KEY, action: "post", data: { url: "u", event: "APPROVE" }, time: 5, version: "v1" },
    { collection: "pulls", objectId: KEY, action: "dismiss", data: null, time: 6, version: "v1" },
  ]);

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /already posted/i, gh);
});

test("refuses a review with nothing in it", () => {
  const { draftsDir } = source({ review: draft({ comment: "", findings: [] }) });
  const gh = stubGh();

  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW }), /empty/i, gh);
});

test("posts the untouched draft, pinned to the live head", () => {
  const { draftsDir } = source({
    review: draft({
      findings: [
        { id: "a", path: "lib/a.rb", line: 3, body: "First." },
        { id: "b", path: "lib/b.rb", line: 9, body: "Second.", suggestion: "fixed" },
        { id: "c", path: "lib/c.rb", line: 1, body: "Sent earlier.", posted: "https://example.test/c" },
      ],
    }),
  });
  const gh = stubGh();

  const result = post({ draftsDir, key: KEY, gh, now: () => NOW });

  assert.deepEqual(result, {
    posted: { key: KEY, url: "https://github.com/org/app/pull/42#pullrequestreview-7", event: "APPROVE" },
  });

  assert.deepEqual(gh.calls[0].args, ["api", "repos/org/app/pulls/42"]);
  assert.equal(gh.posts().length, 1);

  const [sent] = gh.posts();

  assert.deepEqual(sent.args, ["api", "--method", "POST", "repos/org/app/pulls/42/reviews", "--input", "-"]);
  assert.deepEqual(JSON.parse(sent.stdin), {
    body: "Looks right.",
    event: "APPROVE",
    commit_id: HEAD,
    comments: [
      { path: "lib/a.rb", line: 3, side: "RIGHT", body: "First." },
      { path: "lib/b.rb", line: 9, side: "RIGHT", body: "Second.\n\n```suggestion\nfixed\n```" },
    ],
  });
});

test("posts a draft that does not say which commit it reviewed", () => {
  const { draftsDir } = source({ review: draft({ reviewedAt: undefined }) });
  const gh = stubGh();

  assert.ok(post({ draftsDir, key: KEY, gh, now: () => NOW }).posted);
  assert.equal(JSON.parse(gh.posts()[0].stdin).commit_id, HEAD);
});

test("records the post as the app does: a post, then a dismiss", () => {
  const { draftsDir, eventsDir } = source();
  const gh = stubGh();

  post({ draftsDir, key: KEY, gh, now: () => NOW });

  const lines = fs.readFileSync(path.join(eventsDir, SWEEP_LOG), "utf8").trimEnd().split("\n").map(JSON.parse);

  assert.deepEqual(lines, [
    {
      collection: "pulls",
      objectId: KEY,
      action: "post",
      data: { url: "https://github.com/org/app/pull/42#pullrequestreview-7", event: "APPROVE" },
      time: NOW,
      version: "v1",
    },
    { collection: "pulls", objectId: KEY, action: "dismiss", data: null, time: NOW + 1, version: "v1" },
  ]);

  // The log's other readers see a finished pull request.
  assert.deepEqual(resolutions(readEvents(draftsDir)).get(KEY), { action: "dismiss", time: NOW + 1 });

  // And a second run sees its own post.
  refusal(post({ draftsDir, key: KEY, gh, now: () => NOW + 10 }), /already posted/i);
  assert.equal(gh.posts().length, 1);
});

test("appends to a sweep log that already has events in it", () => {
  const { draftsDir, eventsDir } = source();

  writeEvents(eventsDir, SWEEP_LOG, [
    { collection: "pulls", objectId: "org/app#1", action: "post", data: null, time: 1, version: "v1" },
  ]);

  post({ draftsDir, key: KEY, gh: stubGh(), now: () => NOW });

  assert.equal(fs.readFileSync(path.join(eventsDir, SWEEP_LOG), "utf8").trimEnd().split("\n").length, 3);
});

test("says so when the review went out and the log could not be written", () => {
  const { draftsDir, root } = source();
  const gh = stubGh();

  // A file where the log's directory belongs, so nothing can be made under it.
  fs.writeFileSync(path.join(root, ".reviewer"), "in the way");

  const result = post({ draftsDir, key: KEY, gh, now: () => NOW });

  assert.equal(result.posted.key, KEY);
  assert.equal(gh.posts().length, 1);
  assert.equal(typeof result.logError, "string");
  assert.notEqual(result.logError, "");
});

test("lets a failing gh fail loudly", () => {
  const { draftsDir } = source();

  const gh = () => {
    throw new Error("gh: network down");
  };

  assert.throws(() => post({ draftsDir, key: KEY, gh, now: () => NOW }), /network down/);
});
