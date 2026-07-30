// Where reviews go.
//
// Separate from sources on purpose: where drafts come from and where the
// review is posted are independent choices. A team can keep its drafts in a
// bucket and post to GitHub, or keep them on disk and post to GitLab, and
// neither decision should be tangled in the other.
//
// A destination is the writing half of the app. An adapter is the reading half.
// Adding GitLab is adding a file here and naming it below.

import { GitHubDestination } from "./github-destination.js";
import { DemoDestination } from "./demo.js";

const TYPES = [GitHubDestination, DemoDestination];

/**
 * The destination types this build offers.
 *
 * A destination that must never be offered is dropped, the same way a reader
 * is. The demo destination posts nowhere on purpose, so a reader who picked it
 * by hand would have a review that silently goes nowhere.
 *
 * @returns {{type: string, label: string, fields: object[]}[]} what can be added
 */
export function destinationTypes() {
  return TYPES.filter((Destination) => Destination.selectable !== false).map((Destination) => ({
    type: Destination.type,
    label: Destination.label,
    fields: Destination.fields,
  }));
}

/**
 * Build a destination from what was configured and the credential kept beside it.
 *
 * @param {object} destination the stored destination, without its credential
 * @param {object} secret the credential
 * @returns {object} something that can post a review
 * @throws {Error} if this build has no such destination type
 */
export function buildDestination(destination, secret) {
  const Destination = TYPES.find((candidate) => candidate.type === destination.type);

  if (!Destination) {
    throw new Error(`this build cannot post to a ${destination.type}`);
  }

  return new Destination({ ...destination, ...secret });
}

export { GitHubDestination, DemoDestination };
