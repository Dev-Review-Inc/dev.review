// Who was asked to review a pull request, and what each has said.
//
// GitHub drops a request once it is answered, so the requests alone forget
// everyone who already reviewed, and a team is answered by a member's review
// on its behalf. Both halves are needed: the open requests, and the latest
// review per person with the teams it spoke for.

const STATES = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

/**
 * The reviewers of a pull request, from GitHub's GraphQL pullRequest node.
 *
 * @param {object} pull `author`, `reviewRequests` and `latestReviews` as fetched
 * @returns {{name: string, team: boolean, state: string, by?: string}[]} waiting first, then answered
 */
export function reviewersFrom(pull) {
  const list = [];
  const named = new Set();

  for (const { requestedReviewer: who } of pull.reviewRequests?.nodes || []) {
    if (!who) continue;

    const team = who.__typename === "Team";
    const name = team ? who.combinedSlug : who.login;

    if (!name || named.has(name)) continue;

    named.add(name);
    list.push({ name, team, state: "waiting" });
  }

  const teams = [];

  for (const review of pull.latestReviews?.nodes || []) {
    const login = review.author?.login;
    const state = STATES[review.state];

    // PENDING is a review not yet sent, and the author's own are replies.
    if (!login || !state || login === pull.author?.login) continue;

    if (!named.has(login)) {
      named.add(login);
      list.push({ name: login, team: false, state });
    }

    for (const { combinedSlug } of review.onBehalfOf?.nodes || []) {
      if (named.has(combinedSlug)) continue;

      named.add(combinedSlug);
      teams.push({ name: combinedSlug, team: true, state, by: login });
    }
  }

  return [...list, ...teams];
}
