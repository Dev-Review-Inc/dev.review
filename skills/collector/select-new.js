/**
 * Identity of a pull request in the seen-state file.
 *
 * @param {object} pr a pull request from `gh search prs --json`
 * @returns {string} "owner/repo#number"
 */
export function key(pr) {
  return `${pr.repository.nameWithOwner}#${pr.number}`;
}

/**
 * Merge pull request lists, keeping the first appearance of each.
 *
 * The queue is two searches — review requests and the user's own pull
 * requests — and one asking for a review of your own work is in both.
 *
 * @param {...object[]} lists pull requests, in priority order
 * @returns {object[]} one entry per pull request
 */
export function dedupe(...lists) {
  const seen = new Set();
  const merged = [];

  for (const pr of lists.flat()) {
    if (seen.has(key(pr))) continue;

    seen.add(key(pr));
    merged.push(pr);
  }

  return merged;
}

/**
 * Split the open review requests into the ones still needing a draft and the
 * ones this sweep is deferring to the next hour.
 *
 * A pull request is fresh until a draft exists for it; the sweep does not
 * re-draft on later pushes or comments. Nothing records what has been drafted —
 * the drafts are that record.
 *
 * The sync log's word holds even after the draft is pruned: a posted pull is
 * never re-drafted (reviewing it again is the reader's gesture, in the app),
 * and a dismissed one only once it has moved since the dismissal — the same
 * revival rule the app applies.
 *
 * @param {object[]} prs open review requests
 * @param {Set<string>} drafted keys of pull requests a draft already exists for
 * @param {number} limit most pull requests to draft in one sweep
 * @param {Map<string, {action: string, time: number}>} [resolved] terminal
 *   resolutions from the sync log, as prune-drafts' `resolutions` folds them
 * @returns {{fresh: object[], deferred: object[]}}
 */
export function selectNew(prs, drafted, limit, resolved = new Map()) {
  const undrafted = prs.filter((pr) => !drafted.has(key(pr)) && !handled(pr, resolved.get(key(pr))));

  return { fresh: undrafted.slice(0, limit), deferred: undrafted.slice(limit) };
}

/**
 * Whether the log already answers this pull request.
 *
 * @param {object} pr a pull request from `gh search prs --json`
 * @param {{action: string, time: number}} [resolution] how its review ended
 * @returns {boolean} whether drafting it would ask an answered question
 */
function handled(pr, resolution) {
  if (!resolution) return false;
  if (resolution.action === "post") return true;

  // The search's ISO string against the log's millisecond clock; a missing
  // or unparsable updatedAt is NaN, which never reads as newer.
  return !(Date.parse(pr.updatedAt || "") > resolution.time);
}

/**
 * Keep only the pull requests belonging to a workspace's repositories.
 *
 * A workspace is a directory, and its repositories are whatever checkouts were
 * found under it. A review request for something not checked out there is not
 * this workspace's business — there would be nothing to review it against.
 *
 * @param {object[]} prs open review requests
 * @param {string[]} repos "owner/name" of every repository in the workspace
 * @returns {object[]} the pull requests this workspace can review
 */
export function withinWorkspace(prs, repos) {
  const known = new Set(repos.map((repo) => repo.toLowerCase()));

  return prs.filter((pr) => known.has(pr.repository.nameWithOwner.toLowerCase()));
}
