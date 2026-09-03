// GitHub, as one destination among the destinations to come.
//
// The calls themselves are unchanged and still live in github.js: they were
// already right, and they are called straight from the browser with the
// reader's own token so that every review is posted as them and no credential
// exists anywhere but here. This wraps them in the shape every destination answers,
// so adding GitLab is adding a file rather than unpicking this one.

import {
  viewer,
  pullRequest,
  pullFiles,
  postComment,
  postReview,
  issue as issueDetail,
  patchIssueBody,
  postIssueComment,
  closeIssue,
} from "./github.js";

export class GitHubDestination {
  static type = "github";
  static label = "GitHub";

  // What the confirmation sheet says about sending. The sheet asks the
  // destination rather than deciding for itself, because it is the destination
  // that knows where the review is about to go.
  static postLabel = "Post to GitHub";
  static postNote = "nothing has been sent yet";

  // And what it says afterwards. This one really did send, so it is allowed to
  // say so and to hand over a link to the review it wrote.
  static sent = true;
  static postedTitle = "Review posted";
  static postedLink = "read it on GitHub";
  static postedRecord = "posted {age} ago - read it on the destination";

  // What the interface asks for when adding one. A token and nothing else,
  // because anything more would be a setting nobody has needed yet.
  static fields = [
    {
      key: "token",
      label: "Personal access token",
      secret: true,
      hint: "Fine grained, scoped to the repositories you review: pull requests read and write, issues read and write, metadata read.",
    },
  ];

  constructor(config) {
    this.config = config;
    this.token = config.token;
  }

  /**
   * Check the credential, and say who it belongs to.
   *
   * @returns {Promise<{login: string}>} the signed in account
   * @throws {Error} carrying the destination's own message when the token is no good
   */
  async identify() {
    const account = await viewer(this.token);

    return { login: account.login, avatar: account.avatar_url || "" };
  }

  /**
   * The pull request as it stands: the commit a review would be pinned to,
   * and whether the conversation it would land on is still open.
   *
   * One fetch answers both, because it is one response: /pulls/{n} carries the
   * head sha and the state together, and asking twice would spend a request to
   * learn what was already in hand.
   *
   * @param {object} pull which pull request
   * @returns {Promise<{headCommit: string, state: string, merged: boolean, mergedAt: string|null, closedAt: string|null}>} the detail
   */
  async pullDetail(pull) {
    const detail = await pullRequest(this.token, pull);

    return {
      headCommit: detail.head?.sha || "",
      state: detail.state || "open",
      merged: Boolean(detail.merged),
      mergedAt: detail.merged_at || null,
      closedAt: detail.closed_at || null,
    };
  }

  /**
   * The files a pull request changes, each with its patch.
   *
   * @param {object} pull which pull request
   * @returns {Promise<object[]>} one entry per changed file
   */
  files(pull) {
    return pullFiles(this.token, pull);
  }

  /**
   * Post one comment on one line, ahead of any review.
   *
   * @param {object} pull which pull request
   * @param {{commitId: string, path: string, line: number, body: string}} comment what and where
   * @returns {Promise<{url: string}>} where it landed
   */
  async comment(pull, comment) {
    const posted = await postComment(this.token, pull, comment);

    return { url: posted.html_url || "" };
  }

  /**
   * Post the review.
   *
   * @param {object} pull which pull request
   * @param {object} payload a body from reviewPayload
   * @returns {Promise<{url: string}>} where it landed
   */
  async review(pull, payload) {
    const posted = await postReview(this.token, pull, payload);

    return { url: posted.html_url || "" };
  }

  /**
   * An issue's live body, and whether the number is really an issue.
   *
   * GitHub answers the same endpoint for pull requests, marking them with a
   * `pull_request` key, so the caller can tell before writing anything.
   *
   * @param {object} target which issue
   * @returns {Promise<{body: string, title: string, isPull: boolean, url: string, state: string, stateReason: string|null, closedAt: string|null}>} the issue
   */
  async issue(target) {
    const detail = await issueDetail(this.token, target);

    return {
      body: detail.body || "",
      title: detail.title || "",
      isPull: Boolean(detail.pull_request),
      url: detail.html_url || "",
      state: detail.state || "open",
      stateReason: detail.state_reason || null,
      closedAt: detail.closed_at || null,
    };
  }

  /**
   * Rewrite the issue's description.
   *
   * @param {object} target which issue
   * @param {string} body the new body
   * @returns {Promise<{url: string}>} where it lives
   */
  async patchDescription(target, body) {
    const patched = await patchIssueBody(this.token, target, body);

    return { url: patched.html_url || "" };
  }

  /**
   * Close the issue, with the reason the draft proposed.
   *
   * @param {object} target which issue
   * @param {string} reason "duplicate", "not_planned" or "completed"
   * @returns {Promise<{url: string}>} where it lives
   */
  async closeIssue(target, reason) {
    const closed = await closeIssue(this.token, target, reason);

    return { url: closed.html_url || "" };
  }

  /**
   * Post a comment on the issue.
   *
   * @param {object} target which issue
   * @param {string} body what to say
   * @returns {Promise<{url: string}>} where it landed
   */
  async commentOnIssue(target, body) {
    const posted = await postIssueComment(this.token, target, body);

    return { url: posted.html_url || "" };
  }
}
