// The GitHub destination's issue half.
//
// The calls live in github.js; what is tested here is the shape the
// destination answers in, which is what the rest of the app leans on.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { GitHubDestination } from "../../web/src/destinations/github-destination.js";

const anIssue = () => ({ owner: "org", repo: "app", number: 7 });

// stub replaces fetch for one call, recording what the destination asked for.
function stub(payload) {
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });

    return { ok: true, status: 200, json: async () => payload };
  };

  return calls;
}

describe("a github destination reading and writing issues", () => {
  test("answers an issue's live body, and whether it is really an issue", async () => {
    stub({
      number: 7,
      title: "The error is rooted wrong",
      body: "the live body",
      html_url: "https://github.com/org/app/issues/7",
    });

    const destination = new GitHubDestination({ token: "t" });

    assert.deepEqual(await destination.issue(anIssue()), {
      body: "the live body",
      title: "The error is rooted wrong",
      isPull: false,
      url: "https://github.com/org/app/issues/7",
    });
  });

  test("marks a number that is actually a pull request", async () => {
    stub({
      number: 7,
      title: "t",
      body: "b",
      html_url: "https://github.com/org/app/pull/7",
      pull_request: { url: "https://api.github.com/repos/org/app/pulls/7" },
    });

    const destination = new GitHubDestination({ token: "t" });

    assert.equal((await destination.issue(anIssue())).isPull, true);
  });

  test("patches the description and says where it lives", async () => {
    const calls = stub({ number: 7, html_url: "https://github.com/org/app/issues/7" });

    const destination = new GitHubDestination({ token: "t" });
    const patched = await destination.patchDescription(anIssue(), "rewritten");

    assert.equal(calls[0].options.method, "PATCH");
    assert.deepEqual(patched, { url: "https://github.com/org/app/issues/7" });
  });

  test("closes the issue and says where it lives", async () => {
    const calls = stub({ number: 7, state: "closed", html_url: "https://github.com/org/app/issues/7" });

    const destination = new GitHubDestination({ token: "t" });
    const closed = await destination.closeIssue(anIssue(), "duplicate");

    assert.equal(calls[0].options.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      state: "closed",
      state_reason: "duplicate",
    });
    assert.deepEqual(closed, { url: "https://github.com/org/app/issues/7" });
  });

  test("comments on the issue and hands back the comment's own link", async () => {
    const calls = stub({
      id: 1,
      html_url: "https://github.com/org/app/issues/7#issuecomment-1",
    });

    const destination = new GitHubDestination({ token: "t" });
    const posted = await destination.commentOnIssue(anIssue(), "a comment");

    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(posted, { url: "https://github.com/org/app/issues/7#issuecomment-1" });
  });
});
