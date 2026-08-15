// The demo seed, checked against the app that has to render it.
//
// The seed is two static files served to a real build of the reviewer, so
// nothing catches a malformed draft or an unanchorable finding at runtime: the
// pane just comes up wrong in front of whoever the demo was for. This runs the
// seed through the same two readers the app uses, `parseDraft` and `parsePatch`,
// and then checks the one thing neither of them can: that every finding names a
// line that actually exists on the right-hand side of the patch it points into.
//
// Run it directly, or through test/demo/seed.test.js, which calls `check`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { parseDraft } from "../src/domain/draft.js";
import { draftPath, draftKey } from "../src/domain/draft-path.js";
import { parsePatch } from "../src/domain/diff.js";
import { diffText } from "../src/domain/text-diff.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const read = (name) => JSON.parse(readFileSync(resolve(HERE, name), "utf8"));

/**
 * The new-side line numbers a patch can carry a comment on.
 *
 * Added and unchanged lines both have a right-hand number, and GitHub accepts a
 * comment on either. A deleted line has none, which is why a finding about
 * removed code has to point at what replaced it.
 *
 * @param {string} patch the unified diff hunks for one file
 * @returns {Set<number>} every line a finding may anchor to
 */
function anchorable(patch) {
  const lines = new Set();

  for (const hunk of parsePatch(patch)) {
    for (const line of hunk.lines) {
      if (line.newLine !== null) lines.add(line.newLine);
    }
  }

  return lines;
}

/**
 * Check the seed, collecting everything wrong rather than stopping at the first.
 *
 * @returns {string[]} the problems found, empty when the seed is sound
 */
export function check() {
  const queue = read("queue.json");
  const problems = [];

  // Both sources, because the tour and the real review are the same kind of
  // document and a stranger meets the tour first.
  const drafts = ["tour.json", "real.json"].flatMap((name) =>
    Object.entries(read(name).drafts || {}),
  );

  for (const [path, payload] of drafts) {
    let draft;

    try {
      draft = parseDraft(payload);
    } catch (failure) {
      problems.push(`${path}: ${failure.message}`);

      continue;
    }

    // The app derives the filename rather than discovering it, so a draft filed
    // under a path that does not match its own owner/repo/number is never asked
    // for and never appears.
    const derived = draftPath(payload.owner, payload.repo, payload.number);

    if (derived !== path) problems.push(`${path}: draft says it belongs at ${derived}`);

    const key = draftKey(payload.owner, payload.repo, payload.number);
    const entry = (queue.pulls || []).find(
      (pull) => draftKey(pull.owner, pull.repo, pull.number) === key,
    );

    if (!entry) problems.push(`${path}: the queue has no pull request ${key}`);

    // An issue draft has no diff to anchor into; its counterpart is the live
    // body the description will be cut into hunks against, which must exist and
    // must actually differ, or the pane comes up saying nothing would change.
    if (entry?.isIssue) {
      const body = (queue.issues || {})[key];

      if (typeof body !== "string") {
        problems.push(`${path}: the queue has no live body for issue ${key}`);
      } else if (!diffText(body, draft.description).length) {
        problems.push(`${path}: the description proposes no change to ${key}`);
      }

      continue;
    }

    const files = (queue.files || {})[key];

    if (!files) {
      problems.push(`${path}: the queue has no files for ${key}`);

      continue;
    }

    for (const finding of draft.findings) {
      const file = files.find((candidate) => candidate.filename === finding.path);

      if (!file) {
        problems.push(`${key} ${finding.id}: ${finding.path} is not a file in this pull request`);

        continue;
      }

      if (!anchorable(file.patch).has(finding.line)) {
        problems.push(
          `${key} ${finding.id}: ${finding.path}:${finding.line} is not on the new side of the patch`,
        );
      }
    }
  }

  for (const [key, files] of Object.entries(queue.files || {})) {
    for (const file of files) {
      if (!file.patch) continue;

      // A patch GitHub sends is hunks and nothing else. A stray `diff --git` or
      // `+++` header parses as content and shifts every line number after it.
      if (!file.patch.startsWith("@@ ")) {
        problems.push(`${key} ${file.filename}: patch does not start with a hunk header`);
      }

      if (!parsePatch(file.patch).length) {
        problems.push(`${key} ${file.filename}: patch has no hunks`);
      }
    }
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = check();

  for (const problem of problems) console.error(problem);

  console.log(problems.length ? `${problems.length} problems` : "the demo seed is sound");
  process.exit(problems.length ? 1 : 0);
}
