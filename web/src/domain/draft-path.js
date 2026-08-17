// Where a draft lives, derived rather than looked up.
//
// The sweep writes one draft file per pull request or issue it has handled,
// and the listing of those files is the queue: an entry exists because its
// draft does. A pull request with no draft is simply not here yet.

// GitHub owners and repository names are drawn from this set. Anything else did
// not come from the API, and must not reach a URL path.
const NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Assert that a value can be placed in a draft filename.
 *
 * @param {string} value an owner or repository name
 * @returns {string} the value, unchanged
 * @throws {Error} if the value is not a plain GitHub name
 */
function name(value) {
  if (typeof value !== "string" || !NAME.test(value) || value === "." || value === "..") {
    throw new Error(`unusable name: ${value}`);
  }

  return value;
}

/**
 * Assert that a value is a pull request number.
 *
 * @param {number} value the pull request number
 * @returns {number} the value, unchanged
 * @throws {Error} if the value is not a positive integer
 */
function number(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`unusable number: ${value}`);
  }

  return value;
}

/**
 * Path, relative to the served root, of the draft for a pull request.
 *
 * Each pull request owns a directory, so its media (QA recordings, frames)
 * lives beside the draft rather than in a shared pile.
 *
 * @param {string} owner the repository owner, e.g. "org"
 * @param {string} repo the repository name, e.g. "app"
 * @param {number} pull the pull request number
 * @returns {string} e.g. "drafts/org--app-42/review.json"
 * @throws {Error} if any part could walk out of the drafts directory
 */
export function draftPath(owner, repo, pull) {
  return `drafts/${name(owner)}--${name(repo)}-${number(pull)}/review.json`;
}

/**
 * Identity of a pull request, matching the sweep's seen-state keys.
 *
 * @param {string} owner the repository owner
 * @param {string} repo the repository name
 * @param {number} pull the pull request number
 * @returns {string} e.g. "org/app#42"
 */
export function draftKey(owner, repo, pull) {
  return `${name(owner)}/${name(repo)}#${number(pull)}`;
}
