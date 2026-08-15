// The GitHub API, called straight from the browser.
//
// api.github.com allows cross-origin requests with an Authorization header, so
// nothing proxies these calls. The token is the reviewer's own personal access
// token, which means every review posted here is posted as them, and no
// credential exists anywhere but this browser.

const API = "https://api.github.com";

// Open pull requests waiting on the signed-in user, their own, and the issues
// on their plate — search qualifiers cannot be OR-ed, so the queue is four
// searches merged.
const REQUESTED = "is:open is:pr review-requested:@me archived:false";
const MINE = "is:open is:pr author:@me archived:false";
const ASSIGNED = "is:open is:issue assignee:@me archived:false";
const MENTIONED = "is:open is:issue mentions:@me archived:false";

/**
 * Owner and repository of an API repository url.
 *
 * @param {string} url e.g. "https://api.github.com/repos/org/app"
 * @returns {{owner: string, repo: string}} the parsed pair
 * @throws {Error} if the url is not a repository url
 */
export function parseRepository(url) {
  const match = String(url).match(/\/repos\/([^/]+)\/([^/]+)$/);

  if (!match) {
    throw new Error(`not a repository url: ${url}`);
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * Call the GitHub API.
 *
 * @param {string} token a personal access token
 * @param {string} path the path, e.g. "/user"
 * @param {object} [options] fetch options; a body is sent as JSON
 * @returns {Promise<object>} the decoded response
 * @throws {Error} carrying GitHub's own message when the call fails
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
    throw new Error(payload.message || `GitHub responded ${response.status}`);
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
 * Pull requests awaiting the signed-in user's review, their own, and the
 * issues assigned to or mentioning them, across every repository.
 *
 * Review requests come first; an entry answering more than one search — a
 * review asked of you on your own work, an assigned issue that also mentions
 * you — appears once, in the earliest search it answered.
 *
 * @param {string} token a personal access token
 * @returns {Promise<object[]>} one entry per pull request or issue
 */
export async function reviewQueue(token) {
  const [requested, mine, assigned, mentioned] = await Promise.all(
    [REQUESTED, MINE, ASSIGNED, MENTIONED].map((query) =>
      call(token, `/search/issues?q=${encodeURIComponent(query)}&per_page=50`),
    ),
  );

  const seen = new Set();
  const queue = [];

  // Which search an entry came out of is the one thing the merge would lose,
  // and it is what says the reader is being waited on. Requested is walked
  // first so a pull request answering both keeps that, and for issues it is
  // the assignee search that means waited on rather than merely named.
  const searches = [
    { items: requested.items || [], isRequested: true, isIssue: false },
    { items: mine.items || [], isRequested: false, isIssue: false },
    { items: assigned.items || [], isRequested: true, isIssue: true },
    { items: mentioned.items || [], isRequested: false, isIssue: true },
  ];

  for (const search of searches) {
    for (const item of search.items) {
      const { owner, repo } = parseRepository(item.repository_url);
      const key = `${owner}/${repo}#${item.number}`;

      if (seen.has(key)) continue;

      seen.add(key);
      queue.push({
        owner,
        repo,
        number: item.number,
        title: item.title,
        author: item.user?.login || "",
        url: item.html_url,
        updatedAt: item.updated_at,
        createdAt: item.created_at,
        isRequested: search.isRequested,
        // The item's own pull_request key outranks which search answered it: a
        // pull request that mentions the reader must not turn into an issue.
        isIssue: search.isIssue && !item.pull_request,
      });
    }
  }

  return queue;
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
