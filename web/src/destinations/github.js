// The GitHub API, called straight from the browser.
//
// api.github.com allows cross-origin requests with an Authorization header, so
// nothing proxies these calls. The token is the reviewer's own personal access
// token, which means every review posted here is posted as them, and no
// credential exists anywhere but this browser.

const API = "https://api.github.com";

// GitHub allows exactly one review in progress per pull request per
// reviewer. Leaving a comment on the Files tab of github.com starts one
// without saying so, so a reader can hit this without ever having pressed
// "Start a review" themselves - the generic "Validation Failed" GitHub
// answers with says nothing about what actually happened or what to do.
const PENDING_REVIEW = /pending review already exists/i;

/**
 * The clearest thing GitHub said about why a call failed.
 *
 * A validation failure's real reason lives in `errors[]`, one line per field,
 * not in the generic `message` sitting above it - a caller that reads only
 * that top line turns every 422 into the same unhelpful sentence regardless
 * of which field actually failed and why.
 *
 * @param {object} payload GitHub's decoded response body
 * @param {number} status the HTTP status, said only once nothing else was
 * @returns {string} what to show the reader
 */
function reasonFor(payload, status) {
  const detail = (payload.errors || [])
    .map((error) => error.message)
    .filter(Boolean)
    .join(" ");

  if (PENDING_REVIEW.test(detail)) {
    return "GitHub already has a review in progress for this pull request - started on github.com, or opened by a comment left there. Finish or dismiss it on GitHub, then post again from here.";
  }

  return detail || payload.message || `GitHub responded ${status}`;
}

/**
 * Call the GitHub API.
 *
 * @param {string} token a personal access token
 * @param {string} path the path, e.g. "/user"
 * @param {object} [options] fetch options; a body is sent as JSON
 * @returns {Promise<object>} the decoded response
 * @throws {Error} carrying the clearest reason GitHub gave when the call fails
 */
async function call(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(reasonFor(payload, response.status));
  }

  return payload;
}

/**
 * The account a token belongs to, used to check it works before anything else.
 *
 * @param {string} token a personal access token
 * @returns {Promise<{login: string}>} the authenticated user
 */
export function viewer(token) {
  return call(token, "/user");
}

/**
 * A pull request's detail, for the head commit the review will be pinned to.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} pull which pull request
 * @returns {Promise<object>} the pull request
 */
export function pullRequest(token, { owner, repo, number }) {
  return call(token, `/repos/${owner}/${repo}/pulls/${number}`);
}

/**
 * The files a pull request changes, each with the patch to render.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} pull which pull request
 * @returns {Promise<object[]>} one entry per changed file
 */
export function pullFiles(token, { owner, repo, number }) {
  return call(token, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`);
}

/**
 * An issue's detail, for the live body a triage draft will be applied to.
 *
 * GitHub answers this endpoint for pull requests too — a `pull_request` key on
 * the response is what marks the number as a pull request rather than an issue.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} issue which issue
 * @returns {Promise<object>} the issue
 */
export function issue(token, { owner, repo, number }) {
  return call(token, `/repos/${owner}/${repo}/issues/${number}`);
}

/**
 * Rewrite an issue's body, and only its body.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} issue which issue
 * @param {string} body the new body
 * @returns {Promise<object>} the patched issue
 */
export function patchIssueBody(token, { owner, repo, number }, body) {
  return call(token, `/repos/${owner}/${repo}/issues/${number}`, {
    method: "PATCH",
    body: { body },
  });
}

/**
 * Close an issue, saying why the way GitHub says it.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} issue which issue
 * @param {string} reason "duplicate", "not_planned" or "completed"
 * @returns {Promise<object>} the closed issue
 */
export function closeIssue(token, { owner, repo, number }, reason) {
  return call(token, `/repos/${owner}/${repo}/issues/${number}`, {
    method: "PATCH",
    body: { state: "closed", state_reason: reason },
  });
}

/**
 * Post one comment on an issue.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} issue which issue
 * @param {string} body what to say
 * @returns {Promise<object>} the created comment
 */
export function postIssueComment(token, { owner, repo, number }, body) {
  return call(token, `/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: "POST",
    body: { body },
  });
}

/**
 * Post one comment on one line, on its own, ahead of any review.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} pull which pull request
 * @param {{commitId: string, path: string, line: number, body: string}} comment what and where
 * @returns {Promise<object>} the created comment
 */
export function postComment(token, { owner, repo, number }, comment) {
  return call(token, `/repos/${owner}/${repo}/pulls/${number}/comments`, {
    method: "POST",
    body: {
      commit_id: comment.commitId,
      path: comment.path,
      line: comment.line,
      // Findings anchor to the file's new state, which is GitHub's RIGHT side.
      side: "RIGHT",
      body: comment.body,
    },
  });
}

/**
 * Post a review, body and inline comments together.
 *
 * @param {string} token a personal access token
 * @param {{owner: string, repo: string, number: number}} pull which pull request
 * @param {object} payload a body from {@link reviewPayload}
 * @returns {Promise<object>} the created review
 */
export function postReview(token, { owner, repo, number }, payload) {
  return call(token, `/repos/${owner}/${repo}/pulls/${number}/reviews`, {
    method: "POST",
    body: payload,
  });
}
