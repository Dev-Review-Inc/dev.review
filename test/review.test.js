import test from "node:test";
import assert from "node:assert";

import { reviewPayload } from "../web/src/domain/review.js";

const DRAFT = {
  verdict: "REQUEST_CHANGES",
  comment: "**Requesting changes** — one blocker.",
  findings: [
    { id: "a", path: "lib/error.rb", line: 12, body: "never matches", suggestion: null },
    { id: "b", path: "spec/error_spec.rb", line: 4, body: "cannot fail", suggestion: "expect(x).to be < Y\n" },
  ],
};

const payload = (options = {}) =>
  reviewPayload(DRAFT, { commitId: "e612b1b", dropped: new Set(), ...options });

test("posts the comment as the review body under the draft's verdict", () => {
  const body = payload();

  assert.strictEqual(body.body, "**Requesting changes** — one blocker.");
  assert.strictEqual(body.event, "REQUEST_CHANGES");
  assert.strictEqual(body.commit_id, "e612b1b");
});

test("posts each finding as an inline comment on the new side of the diff", () => {
  const [first] = payload().comments;

  assert.deepStrictEqual(first, {
    path: "lib/error.rb",
    line: 12,
    side: "RIGHT",
    body: "never matches",
  });
});

test("renders a suggestion as a committable block below its comment", () => {
  const [, second] = payload().comments;

  assert.strictEqual(second.body, "cannot fail\n\n```suggestion\nexpect(x).to be < Y\n```");
});

test("leaves out the findings the reader dropped", () => {
  const body = payload({ dropped: new Set(["a"]) });

  assert.deepStrictEqual(
    body.comments.map((comment) => comment.path),
    ["spec/error_spec.rb"],
  );
});

test("omits the comments array entirely when every finding was dropped", () => {
  // GitHub rejects an empty comments array, so a review with nothing inline
  // must be sent as a plain review rather than one with no comments.
  const body = payload({ dropped: new Set(["a", "b"]) });

  assert.strictEqual("comments" in body, false);
});

test("lets the reader override the verdict the draft asked for", () => {
  assert.strictEqual(payload({ event: "COMMENT" }).event, "COMMENT");
});

test("uses an edited comment in place of the drafted one", () => {
  assert.strictEqual(payload({ body: "my own words" }).body, "my own words");
});

test("posts an empty body when the findings carry the review", () => {
  assert.strictEqual(payload({ body: "" }).body, "");
  assert.strictEqual(payload({ body: "   " }).comments.length, 2);
});

test("leaves out a finding already posted on its own", () => {
  const posted = {
    ...DRAFT,
    findings: [DRAFT.findings[0], { ...DRAFT.findings[1], posted: "2026-07-30T01:00:00Z" }],
  };

  const body = reviewPayload(posted, { commitId: "e612b1b", dropped: new Set() });

  assert.strictEqual(body.comments.length, 1);
  assert.strictEqual(body.comments[0].path, "lib/error.rb");
});

test("refuses a review that says nothing at all", () => {
  assert.throws(() => payload({ body: "   ", dropped: new Set(["a", "b"]) }), /empty review/);
});

test("refuses a verdict that is not a review event", () => {
  assert.throws(() => payload({ event: "LGTM" }), /review event/);
});

test("keeps a suggestion's trailing newline, which GitHub needs to apply it", () => {
  const body = reviewPayload(
    { ...DRAFT, findings: [{ id: "c", path: "a.rb", line: 1, body: "x", suggestion: "one\ntwo" }] },
    { commitId: "abc", dropped: new Set() },
  );

  assert.strictEqual(body.comments[0].body, "x\n\n```suggestion\none\ntwo\n```");
});

test("puts a prefix ahead of the review body and every comment", () => {
  const body = payload({ prefix: "[bot-assisted]" });

  assert.strictEqual(body.body, "[bot-assisted] **Requesting changes** — one blocker.");
  assert.strictEqual(body.comments[0].body, "[bot-assisted] never matches");
  assert.strictEqual(
    body.comments[1].body,
    "[bot-assisted] cannot fail\n\n```suggestion\nexpect(x).to be < Y\n```",
  );
});

test("leaves an unprefixed send exactly as it was", () => {
  assert.strictEqual(payload({ prefix: "" }).body, payload().body);
});

test("does not prefix a review body the reader opted out of", () => {
  assert.strictEqual(payload({ prefix: "[bot-assisted]", body: "" }).body, "");
});

test("does not prefix a review body the reader rewrote", () => {
  const body = payload({ prefix: "[bot-assisted]", body: "my own words", bodyEdited: true });

  assert.strictEqual(body.body, "my own words");
  // The findings are untouched, so they still carry the agent's mark.
  assert.strictEqual(body.comments[0].body, "[bot-assisted] never matches");
});

test("does not prefix a finding the reader rewrote", () => {
  const edited = {
    ...DRAFT,
    findings: [
      { ...DRAFT.findings[0], body: "my sharper point", editedAt: "2026-08-17T10:00:00Z" },
      DRAFT.findings[1],
    ],
  };

  const body = reviewPayload(edited, {
    commitId: "e612b1b",
    dropped: new Set(),
    prefix: "[bot-assisted]",
  });

  assert.strictEqual(body.comments[0].body, "my sharper point");
  assert.strictEqual(
    body.comments[1].body,
    "[bot-assisted] cannot fail\n\n```suggestion\nexpect(x).to be < Y\n```",
  );
});
