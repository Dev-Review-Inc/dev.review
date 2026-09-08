// The GitHub destination's issue half.
//
// The calls live in github.js; what is tested here is the shape the
// destination answers in, which is what the rest of the app leans on.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { GitHubDestination } from "../../web/src/destinations/github-destination.js";

const anIssue = () => ({ owner: "org", repo: "app", number: 7 });

// stub replaces fetch for one call, recording what the destination asked for.
function stub(payload, { ok = true, status = 200 } = {}) {
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });

    return { ok, status, json: async () => payload };
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
      state: "open",
      stateReason: null,
      closedAt: null,
      commentsCount: 0,
      updatedAt: null,
    });
  });

  test("carries a closed issue's state, reason and moment", async () => {
    stub({
      number: 7,
      title: "t",
      body: "b",
      html_url: "https://github.com/org/app/issues/7",
      state: "closed",
      state_reason: "completed",
      closed_at: "2026-08-30T10:00:00Z",
    });

    const destination = new GitHubDestination({ token: "t" });
    const answered = await destination.issue(anIssue());

    assert.equal(answered.state, "closed");
    assert.equal(answered.stateReason, "completed");
    assert.equal(answered.closedAt, "2026-08-30T10:00:00Z");
  });

  test("answers the head commit and the pull request's fate from one fetch", async () => {
    const calls = stub({
      head: { sha: "e612b1b" },
      state: "closed",
      merged: true,
      merged_at: "2026-08-30T10:00:00Z",
      closed_at: "2026-08-30T10:00:00Z",
    });

    const destination = new GitHubDestination({ token: "t" });

    assert.deepEqual(await destination.pullDetail(anIssue()), {
      headCommit: "e612b1b",
      state: "closed",
      merged: true,
      mergedAt: "2026-08-30T10:00:00Z",
      closedAt: "2026-08-30T10:00:00Z",
    });
    assert.equal(calls.length, 1);
  });

  test("an open pull request answers open, with nothing settled", async () => {
    stub({ head: { sha: "e612b1b" }, state: "open", merged: false, merged_at: null, closed_at: null });

    const destination = new GitHubDestination({ token: "t" });

    assert.deepEqual(await destination.pullDetail(anIssue()), {
      headCommit: "e612b1b",
      state: "open",
      merged: false,
      mergedAt: null,
      closedAt: null,
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

  test("carries the comment count and the last update, from the same fetch as the body", async () => {
    stub({
      number: 7,
      title: "t",
      body: "b",
      html_url: "https://github.com/org/app/issues/7",
      comments: 3,
      updated_at: "2026-08-30T10:00:00Z",
    });

    const destination = new GitHubDestination({ token: "t" });
    const answered = await destination.issue(anIssue());

    assert.equal(answered.commentsCount, 3);
    assert.equal(answered.updatedAt, "2026-08-30T10:00:00Z");
  });
});

describe("a github destination reading drift since a draft was written", () => {
  test("compares two commits", async () => {
    const calls = stub({
      ahead_by: 2,
      commits: [
        {
          sha: "a1b2c3d4e5f6",
          commit: {
            message: "Fix the family catch-all\n\nLonger body explaining why.",
            author: { name: "Someone", date: "2026-08-30T09:00:00Z" },
          },
          author: { login: "someone" },
        },
        {
          sha: "b2c3d4e5f6a1",
          commit: {
            message: "Tidy up",
            author: { name: "No Login", date: "2026-08-30T10:00:00Z" },
          },
          author: null,
        },
      ],
    });

    const destination = new GitHubDestination({ token: "t" });
    const compared = await destination.compare({ owner: "org", repo: "app", number: 42 }, "e612b1b", "a1b2c3d");

    assert.match(calls[0].url, /\/repos\/org\/app\/compare\/e612b1b\.\.\.a1b2c3d$/);
    assert.deepEqual(compared, {
      aheadBy: 2,
      commits: [
        { sha: "a1b2c3d4e5f6", message: "Fix the family catch-all", author: "someone", date: "2026-08-30T09:00:00Z" },
        { sha: "b2c3d4e5f6a1", message: "Tidy up", author: "No Login", date: "2026-08-30T10:00:00Z" },
      ],
    });
  });

  test("a base ref that no longer exists rejects, rather than being swallowed", async () => {
    stub({ message: "No common ancestor between e612b1b and a1b2c3d" }, { ok: false, status: 404 });

    const destination = new GitHubDestination({ token: "t" });

    await assert.rejects(
      destination.compare({ owner: "org", repo: "app", number: 42 }, "e612b1b", "a1b2c3d"),
      /No common ancestor/,
    );
  });

  test("asks for an issue's comments, mapped to author, body and moment", async () => {
    stub([
      { created_at: "2026-08-30T09:00:00Z", user: { login: "sofia" }, body: "still broken for me" },
      { created_at: "2026-08-30T10:00:00Z", user: { login: "tomas" }, body: "confirmed" },
    ]);

    const destination = new GitHubDestination({ token: "t" });
    const comments = await destination.issueComments({ owner: "org", repo: "app", number: 7 });

    assert.deepEqual(comments, [
      { author: "sofia", body: "still broken for me", createdAt: "2026-08-30T09:00:00Z" },
      { author: "tomas", body: "confirmed", createdAt: "2026-08-30T10:00:00Z" },
    ]);
  });
});
