// Who was asked to review a pull request, and what each has said.
//
// GitHub drops a request once it is answered, so the requests alone forget
// everyone who already reviewed. A team never reviews itself: a member
// reviews on its behalf, and only the review knows which team that was.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { reviewersFrom } from "../web/src/domain/reviewers.js";

const user = (login) => ({ requestedReviewer: { __typename: "User", login } });
const team = (combinedSlug) => ({ requestedReviewer: { __typename: "Team", combinedSlug } });
const review = (login, state, teams = []) => ({
  state,
  author: { login },
  onBehalfOf: { nodes: teams.map((combinedSlug) => ({ combinedSlug })) },
});

const aPull = ({ requests = [], reviews = [], author = "dallas" } = {}) => ({
  author: { login: author },
  reviewRequests: { nodes: requests },
  latestReviews: { nodes: reviews },
});

describe("the reviewers of a pull request", () => {
  test("a requested person or team that has not answered is waiting", () => {
    assert.deepEqual(reviewersFrom(aPull({ requests: [user("ana"), team("org/web")] })), [
      { name: "ana", team: false, state: "waiting" },
      { name: "org/web", team: true, state: "waiting" },
    ]);
  });

  test("a person who reviewed shows what they said", () => {
    const reviews = [review("ana", "APPROVED"), review("ben", "CHANGES_REQUESTED"), review("cy", "COMMENTED")];

    assert.deepEqual(reviewersFrom(aPull({ reviews })), [
      { name: "ana", team: false, state: "approved" },
      { name: "ben", team: false, state: "changes requested" },
      { name: "cy", team: false, state: "commented" },
    ]);
  });

  test("a team answered by a member shows that review, and who wrote it", () => {
    const reviews = [review("ana", "APPROVED", ["org/web"])];

    assert.deepEqual(reviewersFrom(aPull({ reviews })), [
      { name: "ana", team: false, state: "approved" },
      { name: "org/web", team: true, state: "approved", by: "ana" },
    ]);
  });

  test("someone asked again is waiting again", () => {
    const pull = aPull({ requests: [user("ana")], reviews: [review("ana", "CHANGES_REQUESTED")] });

    assert.deepEqual(reviewersFrom(pull), [{ name: "ana", team: false, state: "waiting" }]);
  });

  test("the author's own replies and anyone's unsent review are not reviews", () => {
    const pull = aPull({ reviews: [review("dallas", "COMMENTED"), review("ana", "PENDING")] });

    assert.deepEqual(reviewersFrom(pull), []);
  });
});
