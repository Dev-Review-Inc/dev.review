import test from "node:test";
import assert from "node:assert";

import {
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

  await assert.rejects(pullFiles("nope", { owner: "o", repo: "r", number: 1 }), /Bad credentials/);
});

// GitHub allows exactly one review in progress per pull request per reviewer.
// A comment left on github.com's Files tab starts one without saying so, so a
// reader can hit this without ever having pressed "Start a review" themselves
// - the message has to explain that, not just repeat GitHub's generic
// "Validation Failed", which says nothing about what to do next.
test("explains a pending review already open on GitHub, rather than 'Validation Failed'", async () => {
  stub(
    {
      message: "Validation Failed",
      errors: [
        {
          resource: "PullRequestReview",
          code: "custom",
          field: "pull_request_review",
          message: "A review cannot be created because a pending review already exists",
        },
      ],
      documentation_url: "https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request",
    },
    { ok: false, status: 422 },
  );

  await assert.rejects(
    postReview("t", { owner: "o", repo: "r", number: 1 }, { body: "b", event: "COMMENT", commit_id: "abc" }),
    /already (has|have) a review (in progress|pending)/i,
  );
});

// A validation failure's real reason lives in errors[], not in the generic
// top-level message sitting above it - surfacing only that line turns every
// 422 into the same unhelpful sentence regardless of what actually went
// wrong.
test("prefers the specific reason in errors[] over the generic top-level message", async () => {
  stub(
    {
      message: "Validation Failed",
      errors: [{ resource: "PullRequestReview", code: "custom", message: "Cannot approve your own pull request" }],
    },
    { ok: false, status: 422 },
  );

  await assert.rejects(
    postReview("t", { owner: "o", repo: "r", number: 1 }, { body: "b", event: "APPROVE", commit_id: "abc" }),
    /Cannot approve your own pull request/,
  );
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
