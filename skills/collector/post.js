#!/usr/bin/env node
// Post one finished draft to GitHub as a review, when the reader's rules say
// that pull request may go out without being read first.
//
//   post.js run <drafts-dir> <owner/repo#n>
//
// Prints `{ "posted": { key, url, event } }` or `{ "refused": { key, reason } }`
// and exits 0 for both: a refusal is an answer, not a fault. A non-zero exit
// means something unexpected broke (gh could not be reached, GitHub said no),
// and the draft stays a draft for a person to read.
//
// This is the one place the sweep writes to GitHub, so it trusts nothing it
// was told. The caller names a pull request and nothing else; the draft, the
// rules, the live pull request and the sync log are all read again here, and
// any one of them can refuse. What is sent is the untouched draft, built by
// the same translation the app sends through, and the post is written into
// the sync log the way the app writes its own, so the app and the next sweep
// both see a pull request that is done with.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The app's own translation from a draft to a review. review.js is a link to
// web/src/domain/review.js: a second copy of it here would be a second opinion
// about what a draft means.
import { reviewPayload } from "./review.js";

import { draftPath, draftKey } from "./draft-path.js";
import { readEvents } from "./prune-drafts.js";
import { actionFor, readRules } from "./rules.js";

// The sweep's own file in the sync log. The app reads every file in
// `.reviewer/events/` whatever it is called, skipping only the one named for
// its own device id — and it rewrites that one whole on every push. Device ids
// are uuids, so a name that is not one can never be a browser's own file:
// every device takes these events in, and none of them writes over them.
export const SWEEP_LOG = "sweep.jsonl";

// The review events GitHub accepts, which are the verdicts a draft may carry.
const EVENTS = ["APPROVE", "COMMENT", "REQUEST_CHANGES"];

// The sync log's event schema, as web/src/state/event-store-event.js writes it.
const VERSION = "v1";

const KEY = /^([^/]+)\/([^#]+)#(\d+)$/;

/**
 * The parts of a pull request key, checked as safe to put in a path.
 *
 * @param {string} key "owner/repo#42"
 * @returns {{owner: string, repo: string, number: number}|null} null when the
 *   key is not one, or names something that could walk out of the drafts
 *   directory
 */
function parseKey(key) {
  const parts = typeof key === "string" ? key.match(KEY) : null;

  if (!parts) return null;

  const pull = { owner: parts[1], repo: parts[2], number: Number(parts[3]) };

  try {
    draftKey(pull.owner, pull.repo, pull.number);
  } catch {
    return null;
  }

  return pull;
}

/**
 * Whether the sync log has ever recorded a review going out for a pull request.
 *
 * Any post counts, not only the latest word: the app follows every post with
 * a dismiss, so the latest event on a posted pull request is never the post.
 *
 * @param {object[]} events parsed sync-log events, any collection
 * @param {string} key "owner/repo#42"
 * @returns {boolean}
 */
export function alreadyPosted(events, key) {
  return events.some(
    (event) => event && event.collection === "pulls" && event.objectId === key && event.action === "post",
  );
}

/**
 * Whether a draft was written against the commit the pull request is at now.
 *
 * A draft records the commit as `reviewedAt`, usually abbreviated, so the
 * live sha is matched by prefix.
 *
 * @param {string} reviewedAt the draft's commit, full or abbreviated
 * @param {string} head the pull request's head sha
 * @returns {boolean}
 */
function sameCommit(reviewedAt, head) {
  return String(head).toLowerCase().startsWith(reviewedAt.toLowerCase());
}

/**
 * Write a sent review into the sync log, as the app records its own: the
 * post, then the dismiss that takes it off the queue (see `recordPostedReview`
 * in web/src/commands/index.js). The dismiss is a millisecond later so every
 * reader agrees which came last.
 *
 * @param {string} draftsDir the drafts directory
 * @param {string} file the log file's name within `.reviewer/events/`
 * @param {string} key "owner/repo#42"
 * @param {{url: string, event: string}} review what was sent, and where it landed
 * @param {number} time when it was sent, milliseconds since the epoch
 * @returns {void}
 * @throws {Error} if the log cannot be written
 */
function record(draftsDir, file, key, review, time) {
  const dir = path.join(draftsDir, "..", ".reviewer", "events");

  const lines = [
    { collection: "pulls", objectId: key, action: "post", data: review, time, version: VERSION },
    { collection: "pulls", objectId: key, action: "dismiss", data: null, time: time + 1, version: VERSION },
  ];

  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, file), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

/**
 * Post one pull request's finished draft as a review, or say why not.
 *
 * @param {object} options
 * @param {string} options.draftsDir the drafts directory
 * @param {string} options.key which pull request, "owner/repo#42"
 * @param {(args: string[], stdin?: string) => string} options.gh runs gh with
 *   these arguments (and this on stdin), answering its stdout
 * @param {() => number} [options.now] the time, milliseconds since the epoch
 * @param {string} [options.logFile] the sync-log file to record the post in
 * @returns {{posted: {key: string, url: string, event: string}, logError?: string}|{refused: {key: string, reason: string}}}
 *   `logError` is set when the review went out and the sync log could not be
 *   written: the post stands, and nothing on disk knows about it
 * @throws {Error} if gh fails, or answers with something that is not JSON
 */
export function post({ draftsDir, key, gh, now = Date.now, logFile = SWEEP_LOG }) {
  const refuse = (reason) => ({ refused: { key, reason } });
  const pull = parseKey(key);

  if (!pull) return refuse("the key is not an owner/repo#number");

  const file = path.join(draftsDir, draftPath(pull.owner, pull.repo, pull.number).replace(/^drafts\//, ""));

  if (!fs.existsSync(file)) return refuse("there is no draft for this pull request");

  let draft;

  try {
    draft = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return refuse(`the draft is unreadable: ${error.message}`);
  }

  if (!draft || typeof draft !== "object") return refuse("the draft is unreadable: it is not an object");
  if (!draft.finishedAt) return refuse("the draft is not finished");
  if (!EVENTS.includes(draft.verdict)) return refuse(`the draft's verdict, ${draft.verdict}, is not a review event`);

  let rules;

  try {
    rules = readRules(draftsDir);
  } catch (error) {
    return refuse(`the rules could not be read: ${error.message}`);
  }

  const api = `repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`;
  const live = JSON.parse(gh(["api", api]));
  const author = live.user?.login || "";
  const head = live.head?.sha || "";

  if (live.state !== "open") return refuse(`the pull request is ${live.state}, not open`);

  if (!author || author.toLowerCase() !== String(draft.author || "").toLowerCase()) {
    return refuse(`the pull request's author is ${author}, and the draft was written for ${draft.author}`);
  }

  if (draft.reviewedAt && !sameCommit(draft.reviewedAt, head)) {
    return refuse(`the draft is stale: it reviewed ${draft.reviewedAt}, and the pull request is at ${head}`);
  }

  // The rules are asked again here, on what GitHub says now, rather than
  // taken from whoever called: a label added since the sweep began counts.
  const action = actionFor(rules, {
    author,
    repo: `${pull.owner}/${pull.repo}`,
    verdict: draft.verdict,
    labels: (live.labels || []).map((label) => label.name),
    isDraft: live.draft,
  });

  if (action !== "post") return refuse(`the rules say ${action} for this pull request, not post`);

  if (alreadyPosted(readEvents(draftsDir), key)) {
    return refuse("a review was already posted for this pull request");
  }

  let payload;

  try {
    // Nothing is dropped. The app sends every finding the reader has not
    // dropped and that has not already been posted (`findingsToPost` in
    // web/src/queries/index.js); flagged-only is a reading mode and changes
    // nothing that is sent. An auto-post is the draft nobody has touched, so
    // the reader's drops, edits and verdict in the sync log are not consulted:
    // a pull request they have started deciding about is theirs to send.
    payload = reviewPayload(draft, { commitId: head, dropped: new Set() });
  } catch (error) {
    return refuse(`there is nothing to post: ${error.message}`);
  }

  const sent = JSON.parse(gh(["api", "--method", "POST", `${api}/reviews`, "--input", "-"], JSON.stringify(payload)));
  const posted = { key, url: sent.html_url, event: payload.event };

  try {
    record(draftsDir, logFile, key, { url: posted.url, event: posted.event }, now());
  } catch (error) {
    return { posted, logError: error.message };
  }

  return { posted };
}

/**
 * Run the real gh.
 *
 * @param {string[]} args gh's arguments
 * @param {string} [stdin] what to feed it
 * @returns {string} what it printed
 * @throws {Error} if gh exits non-zero
 */
function runGh(args, stdin) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: stdin,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Whether this module is the script node was asked to run.
 *
 * The installed skill reaches this file through a symlink, and node resolves
 * `import.meta.filename` to the real path while argv[1] stays as typed — so
 * the two are compared as real paths, or the installed CLI silently does
 * nothing.
 *
 * @returns {boolean}
 */
function invokedDirectly() {
  try {
    return fs.realpathSync(process.argv[1]) === import.meta.filename;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const [command, draftsDir, key] = process.argv.slice(2);

  if (command === "run" && draftsDir && key) {
    console.log(JSON.stringify(post({ draftsDir, key, gh: runGh }), null, 2));
  } else {
    console.error("usage: post.js run <drafts-dir> <owner/repo#n>");
    process.exit(1);
  }
}
