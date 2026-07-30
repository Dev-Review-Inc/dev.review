// The GitHub API, called straight from the browser.
//
// api.github.com allows cross-origin requests with an Authorization header, so
// nothing proxies these calls. The token is the reviewer's own personal access
// token, which means every review posted here is posted as them, and no
// credential exists anywhere but this browser.

const API = "https://api.github.com";

// Open pull requests waiting on the signed-in user, and their own — search
// qualifiers cannot be OR-ed, so the queue is two searches merged.
const REQUESTED = "is:open is:pr review-requested:@me archived:false";
const MINE = "is:open is:pr author:@me archived:false";

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
 * Pull requests awaiting the signed-in user's review, and their own, across
 * every repository.
 *
 * Review requests come first; a pull request that is both — a review asked
 * of you on your own work — appears once.
 *
 * @param {string} token a personal access token
 * @returns {Promise<object[]>} one entry per pull request
 */
export async function reviewQueue(token) {
  const [requested, mine] = await Promise.all(
    [REQUESTED, MINE].map((query) =>
      call(token, `/search/issues?q=${encodeURIComponent(query)}&per_page=50`),
    ),
  );

  const seen = new Set();
  const queue = [];

  for (const item of [...(requested.items || []), ...(mine.items || [])]) {
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
    });
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
