import test from "node:test";
import assert from "node:assert";

import { parseRepository, reviewQueue, pullFiles, postReview, postComment } from "../web/src/destinations/github.js";

// stub replaces fetch for one call, recording what the module asked for.
function stub(payload, { ok = true, status = 200 } = {}) {
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });

    return { ok, status, json: async () => payload };
  };

  return calls;
}

test("reads owner and repository out of an api repository url", () => {
  assert.deepStrictEqual(parseRepository("https://api.github.com/repos/org/app"), {
    owner: "org",
    repo: "app",
  });
});

test("refuses a url that is not a repository", () => {
  assert.throws(() => parseRepository("https://api.github.com/user"), /not a repository url/);
});

test("asks for review requests and the user's own pull requests", async () => {
  const calls = stub({ items: [] });

  await reviewQueue("gho_token");

  assert.strictEqual(calls.length, 2);
  assert.match(calls[0].url, /review-requested%3A%40me/);
  assert.match(calls[0].url, /is%3Aopen/);
  assert.match(calls[1].url, /author%3A%40me/);
  assert.strictEqual(calls[0].options.headers.Authorization, "Bearer gho_token");
});

test("merges the two searches without duplicating a pull request in both", async () => {
  const entry = (number) => ({
    repository_url: "https://api.github.com/repos/org/app",
    number,
    title: `#${number}`,
    user: { login: "me" },
    html_url: `https://github.com/org/app/pull/${number}`,
    updated_at: "2026-07-29T15:00:00Z",
    created_at: "2026-07-29T09:00:00Z",
  });

  // The same payload answers both searches, as when someone asks for a
  // review of the user's own pull request.
  stub({ items: [entry(1), entry(2)] });

  const queue = await reviewQueue("t");

  assert.deepStrictEqual(queue.map((pull) => pull.number), [1, 2]);
});

test("flattens a review request into what the queue needs", async () => {
  stub({
    items: [
      {
        repository_url: "https://api.github.com/repos/org/app",
        number: 42,
        title: "Re-root the errors",
        user: { login: "someone" },
        html_url: "https://github.com/org/app/pull/42",
        updated_at: "2026-07-29T15:00:00Z",
        created_at: "2026-07-27T09:00:00Z",
      },
    ],
  });

  assert.deepStrictEqual(await reviewQueue("t"), [
    {
      owner: "org",
      repo: "app",
      number: 42,
      title: "Re-root the errors",
      author: "someone",
      url: "https://github.com/org/app/pull/42",
      updatedAt: "2026-07-29T15:00:00Z",
      createdAt: "2026-07-27T09:00:00Z",
    },
  ]);
});

test("posts one comment on its own line", async () => {
  const calls = stub({ id: 1, html_url: "https://github.com/org/app/pull/1#discussion_r1" });

  await postComment("t", { owner: "org", repo: "app", number: 1 }, {
    commitId: "abc1234",
    path: "lib/thing.rb",
    line: 12,
    body: "never matches",
  });

  assert.match(calls[0].url, /\/repos\/org\/app\/pulls\/1\/comments$/);
  assert.strictEqual(calls[0].options.method, "POST");

  const sent = JSON.parse(calls[0].options.body);

  assert.deepStrictEqual(sent, {
    commit_id: "abc1234",
    path: "lib/thing.rb",
    line: 12,
    side: "RIGHT",
    body: "never matches",
  });
});

test("raises GitHub's own message rather than a status code", async () => {
  stub({ message: "Bad credentials" }, { ok: false, status: 401 });

  await assert.rejects(reviewQueue("nope"), /Bad credentials/);
});



test("asks for the files a pull request changes", async () => {
  const calls = stub([]);

  await pullFiles("t", { owner: "org", repo: "app", number: 42 });

  assert.match(calls[0].url, /\/repos\/org\/app\/pulls\/42\/files/);
});

test("posts a prepared review payload untouched", async () => {
  const calls = stub({ id: 1 });
  const payload = { body: "b", event: "COMMENT", commit_id: "abc", comments: [] };

  await postReview("t", { owner: "o", repo: "r", number: 1 }, payload);

  assert.deepStrictEqual(JSON.parse(calls[0].options.body), payload);
});
