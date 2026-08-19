// Turning a draft the reader has been through into what GitHub is sent.
//
// This is the last point at which the review is still ours. Everything the
// reader decided — an edited body, a different verdict, findings they dropped —
// is applied here, so the request that goes out is exactly what they approved.

// The review events GitHub accepts.
const EVENTS = ["APPROVE", "COMMENT", "REQUEST_CHANGES"];

/**
 * A finding's comment body, with its suggestion rendered committably.
 *
 * GitHub applies a suggestion block as a patch, and needs the replacement to
 * end in a newline before the closing fence or the Apply button silently does
 * the wrong thing to the following line.
 *
 * @param {object} finding a finding from the draft
 * @returns {string} the markdown to post
 */
export function bodyOf(finding) {
  if (!finding.suggestion) return finding.body;

  const replacement = finding.suggestion.endsWith("\n")
    ? finding.suggestion
    : `${finding.suggestion}\n`;

  return `${finding.body}\n\n\`\`\`suggestion\n${replacement}\`\`\``;
}

/**
 * Put the reader's prefix ahead of something about to be sent.
 *
 * @param {string} prefix what the reader configured, empty when they have not
 * @param {string} body the markdown it would lead
 * @returns {string} the markdown to send
 */
export function withPrefix(prefix, body) {
  const trimmed = (prefix || "").trim();

  return trimmed && body ? `${trimmed} ${body}` : body;
}

/**
 * Build the request body for posting a review.
 *
 * @param {object} draft the draft being posted
 * @param {object} options what the reader decided
 * @param {string} options.commitId the commit the review is pinned to
 * @param {Set<string>} options.dropped ids of findings not to post
 * @param {string} [options.body] the review body, if it was edited
 * @param {string} [options.event] the verdict, if it was overridden
 * @param {string} [options.prefix] the reader's prefix, ahead of the body and every comment.
 *   It marks the agent's words, so anything the reader rewrote goes without it:
 *   a finding carrying `editedAt`, and the body when `options.bodyEdited`.
 * @param {boolean} [options.bodyEdited] whether the reader rewrote the body
 * @returns {object} the body for POST /repos/{owner}/{repo}/pulls/{n}/reviews
 * @throws {Error} if there is nothing to post at all, or the verdict is not an event
 */
export function reviewPayload(draft, options) {
  const body = options.body ?? draft.comment;
  const event = options.event ?? draft.verdict;

  if (!EVENTS.includes(event)) {
    throw new Error(`${event} is not a review event`);
  }

  const comments = (draft.findings || [])
    .filter((finding) => !options.dropped.has(finding.id) && !finding.posted)
    .map((finding) => ({
      path: finding.path,
      line: finding.line,
      // Findings anchor to the file's new state, which is GitHub's RIGHT side.
      side: "RIGHT",
      body: withPrefix(finding.editedAt || finding.mine ? "" : options.prefix, bodyOf(finding)),
    }));

  // An empty body is fine when the findings carry the review; a review with
  // neither says nothing, and nothing is not worth posting.
  if ((!body || !body.trim()) && !comments.length) {
    throw new Error("refusing to post an empty review");
  }

  const prefixedBody = withPrefix(options.bodyEdited ? "" : options.prefix, body);

  // An empty comments array is rejected, so a review with nothing inline is
  // sent as a plain review instead of one carrying no comments.
  return comments.length
    ? { body: prefixedBody, event, commit_id: options.commitId, comments }
    : { body: prefixedBody, event, commit_id: options.commitId };
}
