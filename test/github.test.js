import test from "node:test";
import assert from "node:assert";

import {
  parseRepository,
  reviewQueue,
  pullFiles,
  postReview,
  postComment,
  issue,
  patchIssueBody,
  postIssueComment,
  closeIssue,
} from "../web/src/destinations/github.js";

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

test("asks for review requests, the user's own pull requests, and their issues", async () => {
  const calls = stub({ items: [] });

  await reviewQueue("gho_token");

  assert.strictEqual(calls.length, 4);
  assert.match(calls[0].url, /review-requested%3A%40me/);
  assert.match(calls[0].url, /is%3Aopen/);
  assert.match(calls[1].url, /author%3A%40me/);
  assert.match(calls[2].url, /is%3Aissue.*assignee%3A%40me/);
  assert.match(calls[3].url, /is%3Aissue.*mentions%3A%40me/);
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
      isRequested: true,
      isIssue: false,
    },
  ]);
});

test("carries issues from the issue searches, marked as issues", async () => {
  const entry = (number) => ({
    repository_url: "https://api.github.com/repos/org/app",
    number,
    title: `#${number}`,
    user: { login: "me" },
    html_url: `https://github.com/org/app/issues/${number}`,
    updated_at: "2026-08-15T15:00:00Z",
    created_at: "2026-08-15T09:00:00Z",
  });

  // 5 is assigned, 6 is only mentioned. The pull request searches are empty.
  globalThis.fetch = async (url) => {
    const query = String(url);
    const items = query.includes("assignee")
      ? [entry(5)]
      : query.includes("mentions")
        ? [entry(6)]
        : [];

    return { ok: true, status: 200, json: async () => ({ items }) };
  };

  const queue = await reviewQueue("t");

  assert.deepStrictEqual(
    queue.map((item) => [item.number, item.isIssue, item.isRequested]),
    [
      [5, true, true],
      [6, true, false],
    ],
  );
});

test("keeps a pull request a pull request even when a search hands it back oddly", async () => {
  // The search item's own pull_request key is the truth: a pull request that
  // mentions the reader must not turn into an issue.
  const asPull = {
    repository_url: "https://api.github.com/repos/org/app",
    number: 8,
    title: "#8",
    user: { login: "me" },
    html_url: "https://github.com/org/app/pull/8",
    updated_at: "2026-08-15T15:00:00Z",
    created_at: "2026-08-15T09:00:00Z",
    pull_request: { url: "https://api.github.com/repos/org/app/pulls/8" },
  };

  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ items: String(url).includes("mentions") ? [asPull] : [] }),
  });

  const queue = await reviewQueue("t");

  assert.deepStrictEqual(
    queue.map((item) => [item.number, item.isIssue]),
    [[8, false]],
  );
});

test("dedupes across all four searches", async () => {
  const entry = {
    repository_url: "https://api.github.com/repos/org/app",
    number: 9,
    title: "#9",
    user: { login: "me" },
    html_url: "https://github.com/org/app/pull/9",
    updated_at: "2026-08-15T15:00:00Z",
    created_at: "2026-08-15T09:00:00Z",
  };

  // The same entry answers every search.
  stub({ items: [entry] });

  const queue = await reviewQueue("t");

  assert.strictEqual(queue.length, 1);
  // The pull request searches are walked first, so it stays a pull request.
  assert.strictEqual(queue[0].isIssue, false);
});

// Which search a pull request came out of is the difference between a review
// someone is waiting on and the reader's own work, and the merge is the only
// place that still knows.
test("says which pull requests the reader's review is actually requested of", async () => {
  const entry = (number) => ({
    repository_url: "https://api.github.com/repos/org/app",
    number,
    title: `#${number}`,
    user: { login: "me" },
    html_url: `https://github.com/org/app/pull/${number}`,
    updated_at: "2026-07-29T15:00:00Z",
    created_at: "2026-07-29T09:00:00Z",
  });

  // 1 is asked of the reader, 2 is asked of them on their own pull request,
  // and 3 is only theirs.
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({
      items: String(url).includes("review-requested") ? [entry(1), entry(2)] : [entry(2), entry(3)],
    }),
  });

  const queue = await reviewQueue("t");

  assert.deepStrictEqual(
    queue.map((pull) => [pull.number, pull.isRequested]),
    [
      [1, true],
      [2, true],
      [3, false],
    ],
  );
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

test("asks for an issue and hands back what GitHub says about it", async () => {
  const calls = stub({ number: 7, body: "the live body", pull_request: undefined });

  const answered = await issue("t", { owner: "org", repo: "app", number: 7 });

  assert.match(calls[0].url, /\/repos\/org\/app\/issues\/7$/);
  assert.strictEqual(calls[0].options.method, "GET");
  assert.strictEqual(answered.body, "the live body");
});

test("patches an issue's body and nothing else", async () => {
  const calls = stub({ number: 7, body: "rewritten" });

  await patchIssueBody("t", { owner: "org", repo: "app", number: 7 }, "rewritten");

  assert.match(calls[0].url, /\/repos\/org\/app\/issues\/7$/);
  assert.strictEqual(calls[0].options.method, "PATCH");
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { body: "rewritten" });
});

test("posts a comment on an issue", async () => {
  const calls = stub({ id: 1, html_url: "https://github.com/org/app/issues/7#issuecomment-1" });

  await postIssueComment("t", { owner: "org", repo: "app", number: 7 }, "a comment");

  assert.match(calls[0].url, /\/repos\/org\/app\/issues\/7\/comments$/);
  assert.strictEqual(calls[0].options.method, "POST");
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { body: "a comment" });
});

test("closes an issue with the reason the draft gave", async () => {
  const calls = stub({ number: 7, state: "closed" });

  await closeIssue("t", { owner: "org", repo: "app", number: 7 }, "not_planned");

  assert.match(calls[0].url, /\/repos\/org\/app\/issues\/7$/);
  assert.strictEqual(calls[0].options.method, "PATCH");
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    state: "closed",
    state_reason: "not_planned",
  });
});

test("posts a prepared review payload untouched", async () => {
  const calls = stub({ id: 1 });
  const payload = { body: "b", event: "COMMENT", commit_id: "abc", comments: [] };

  await postReview("t", { owner: "o", repo: "r", number: 1 }, payload);

  assert.deepStrictEqual(JSON.parse(calls[0].options.body), payload);
});
