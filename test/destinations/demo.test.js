// The destination behind the demo.
//
// The whole point of it is what it does not do. A visitor to a marketing page
// has given us no token and no permission, so every method that would reach
// GitHub has to be inert, and inert has to be provable rather than asserted in
// a comment.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DemoDestination } from "../../web/src/destinations/demo.js";
import { destinationTypes, buildDestination } from "../../web/src/destinations/index.js";

const aPull = () => ({
  owner: "org",
  repo: "app",
  number: 1,
  url: "https://github.com/org/app/pull/1",
});

const aSeed = () => ({
  login: "you",
  pulls: [aPull()],
  files: { "org/app#1": [{ filename: "lib/error.rb", status: "modified", patch: "@@" }] },
  commits: { "org/app#1": "e612b1b" },
});

function serving(document, asked = []) {
  return async (url) => {
    asked.push(url);

    return { ok: true, json: async () => document };
  };
}

describe("a demo destination with sample data behind it", () => {
  test("says who the reader is without asking anyone", async () => {
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: serving(aSeed()) });

    assert.deepEqual(await destination.identify(), { login: "you", avatar: "" });
  });

  test("answers the queue out of its seed", async () => {
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: serving(aSeed()) });

    const queue = await destination.queue();

    assert.equal(queue.length, 1);
    assert.equal(queue[0].number, 1);
    // Seeds predate issues, so an entry that does not say is a pull request.
    assert.equal(queue[0].isIssue, false);
  });

  test("answers the diff and the head commit for a pull request it holds", async () => {
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: serving(aSeed()) });

    assert.equal((await destination.files(aPull()))[0].filename, "lib/error.rb");
    assert.equal(await destination.headCommit(aPull()), "e612b1b");
  });

  test("answers nothing for a pull request its seed does not carry", async () => {
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: serving(aSeed()) });
    const stranger = { ...aPull(), number: 99 };

    assert.deepEqual(await destination.files(stranger), []);
    assert.equal(await destination.headCommit(stranger), "");
  });

  test("asks for the seed once however much is read from it", async () => {
    const asked = [];
    const destination = new DemoDestination({
      seed: "/demo/queue.json",
      fetch: serving(aSeed(), asked),
    });

    await destination.identify();
    await destination.queue();
    await destination.files(aPull());

    assert.deepEqual(asked, ["/demo/queue.json"]);
  });

  test("posts nothing anywhere, and does not so much as fetch", async () => {
    const asked = [];
    const destination = new DemoDestination({
      seed: "/demo/queue.json",
      fetch: serving(aSeed(), asked),
    });

    const comment = await destination.comment(aPull(), { body: "no" });
    const review = await destination.review(aPull(), { event: "APPROVE" });

    assert.deepEqual(comment, { url: "https://github.com/org/app/pull/1" });
    assert.deepEqual(review, { url: "https://github.com/org/app/pull/1" });
    assert.deepEqual(asked, [], "posting must never reach the network");
  });

  test("answers an issue's live body out of its seed", async () => {
    const seed = {
      ...aSeed(),
      issues: { "org/app#1": "the export is broken, please fix" },
    };
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: serving(seed) });
    const target = { ...aPull(), title: "Export broken", url: "https://github.com/org/app/issues/1" };

    const answered = await destination.issue(target);

    assert.equal(answered.body, "the export is broken, please fix");
    assert.equal(answered.title, "Export broken");
    assert.equal(answered.isPull, false);
    assert.equal(answered.url, "https://github.com/org/app/issues/1");
  });

  test("answers a canned body for an issue its seed does not carry", async () => {
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: serving(aSeed()) });

    const answered = await destination.issue(aPull());

    assert.ok(answered.body);
    assert.ok(answered.title);
    assert.equal(answered.isPull, false);
  });

  test("takes issue writes nowhere, without so much as fetching", async () => {
    const asked = [];
    const destination = new DemoDestination({
      seed: "/demo/queue.json",
      fetch: serving(aSeed(), asked),
    });
    const target = { ...aPull(), url: "https://github.com/org/app/issues/1" };

    const patched = await destination.patchDescription(target, "rewritten");
    const commented = await destination.commentOnIssue(target, "a comment");
    const closed = await destination.closeIssue(target, "not_planned");

    assert.deepEqual(patched, { url: "https://github.com/org/app/issues/1" });
    assert.deepEqual(commented, { url: "https://github.com/org/app/issues/1" });
    assert.deepEqual(closed, { url: "https://github.com/org/app/issues/1" });
    assert.deepEqual(asked, [], "issue writes must never reach the network");
  });

  test("says plainly that nothing is sent", () => {
    assert.match(DemoDestination.postNote, /nothing is sent/i);
    assert.equal(DemoDestination.postLabel, "Post review");
  });
});

describe("a demo destination whose sample data was never deployed", () => {
  const missing = async () => ({ ok: false, status: 404 });

  test("reports the problem where the reader is shown problems", async () => {
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: missing });

    await assert.rejects(() => destination.identify(), /sample data/i);
  });

  test("has an empty queue rather than a crash", async () => {
    const destination = new DemoDestination({ seed: "/demo/queue.json", fetch: missing });

    assert.deepEqual(await destination.queue(), []);
  });
});

describe("the destinations a build offers", () => {
  test("never offers the demo destination, which the demo attaches itself", () => {
    assert.equal(
      destinationTypes().some((type) => type.type === "demo"),
      false,
    );
  });

  test("still knows how to rebuild one that was attached", () => {
    const built = buildDestination({ type: "demo", label: "Demo", seed: "/demo/queue.json" }, {});

    assert.ok(built instanceof DemoDestination);
  });
});
