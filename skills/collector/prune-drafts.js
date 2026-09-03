#!/usr/bin/env node
// Delete drafts whose review is done with, so the drafts directory does not
// hold onto pull requests nobody will read about again.
//
//   prune-drafts.js run <drafts-dir>       delete finished drafts, print which ones
//   prune-drafts.js settled <drafts-dir>   delete drafts closed or merged upstream
//
// "Done with" comes from two places. `run` reads the app's own sync log, not
// age or GitHub: a pull request is finished once its most recent
// `pulls`-collection event is "post" or "dismiss", and a later "restore"
// undoes that. `settled` asks GitHub: a merged or closed pull request or
// issue is over regardless of what the reader did about its draft.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { draftPath, draftKey } from "./draft-path.js";

const TERMINAL = new Set(["post", "dismiss"]);
const KEY = /^([^/]+)\/([^#]+)#(\d+)$/;

/**
 * Parse a sync log's lines into events, skipping any line that will not
 * parse.
 *
 * The log is appended to by a browser that can be closed or lose its network
 * mid-write, so a partial trailing line is expected here, not a bug. One bad
 * line is one lost event, not a lost log.
 *
 * @param {string} text a `.jsonl` file's contents
 * @returns {object[]} parsed events, malformed lines dropped
 */
export function parseEventLines(text) {
  const events = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    try {
      events.push(JSON.parse(line));
    } catch {
      // Noted by omission: the event this line meant is gone, but the rest
      // of the log still reads.
    }
  }

  return events;
}

/**
 * Every event in every device's sync log for a source.
 *
 * One file per device (see web/src/state/sync.js), all of them read here
 * because any one of them can hold the most recent word on a pull request.
 *
 * @param {string} draftsDir the source's drafts directory
 * @returns {object[]} parsed events from every `.jsonl` file found, in no
 *   particular order
 */
export function readEvents(draftsDir) {
  const eventsDir = path.join(draftsDir, "..", ".reviewer", "events");
  let files;

  try {
    files = fs.readdirSync(eventsDir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    // No log yet is not a fault: a source with nothing synced has nothing
    // finished either.
    return [];
  }

  return files.flatMap((name) => {
    try {
      return parseEventLines(fs.readFileSync(path.join(eventsDir, name), "utf8"));
    } catch {
      return [];
    }
  });
}

/**
 * How each pull request's review ended, for the ones that ended at all.
 *
 * A pull key's state is whatever its most recent `pulls`-collection event
 * says, across every device's log — not "has it ever had a post or dismiss
 * event". A restore after a dismiss puts it back on the queue, so a key
 * whose latest word is a restore is absent here.
 *
 * @param {object[]} events parsed sync-log events, any collection
 * @returns {Map<string, {action: string, time: number}>} terminal
 *   resolutions by pull key ("owner/repo#42"), time in milliseconds
 */
export function resolutions(events) {
  const latest = new Map();

  for (const event of events) {
    if (!event || event.collection !== "pulls") continue;
    if (typeof event.objectId !== "string" || typeof event.action !== "string") continue;
    if (typeof event.time !== "number") continue;

    const current = latest.get(event.objectId);

    if (!current || event.time > current.time) latest.set(event.objectId, { action: event.action, time: event.time });
  }

  const resolved = new Map();

  for (const [key, state] of latest) {
    if (TERMINAL.has(state.action)) resolved.set(key, state);
  }

  return resolved;
}

/**
 * The pull requests whose review is done with: posted or dismissed, and not
 * since restored.
 *
 * @param {object[]} events parsed sync-log events, any collection
 * @returns {Set<string>} pull keys ("owner/repo#42") safe to delete the draft for
 */
export function finishedPulls(events) {
  return new Set(resolutions(events).keys());
}

/**
 * Delete every draft (and its media — qa.mp4, frames/, whatever sits beside
 * review.json) whose pull request is finished.
 *
 * Only removes files on disk. Making the deletion visible to whatever reads
 * the storage is the sweep's job, reusing the same "Leave the storage synced"
 * step a draft write already goes through.
 *
 * @param {string} draftsDir the drafts directory
 * @returns {string[]} pull keys whose draft was deleted
 */
export function pruneDrafts(draftsDir) {
  const pruned = [];

  for (const key of finishedPulls(readEvents(draftsDir))) {
    const parts = key.match(KEY);

    if (!parts) continue;

    let relative;

    try {
      relative = draftPath(parts[1], parts[2], Number(parts[3])).replace(/^drafts\//, "");
    } catch {
      continue;
    }

    const dir = path.join(draftsDir, path.dirname(relative));

    if (!fs.existsSync(dir)) continue;

    fs.rmSync(dir, { recursive: true, force: true });
    pruned.push(key);
  }

  return pruned;
}

/**
 * The drafts on disk, identified by their own review.json rather than by
 * parsing folder names — `--` and `-` both appear inside owner and repository
 * names, so the name alone is ambiguous.
 *
 * A folder whose review.json is missing or unreadable has no key here, and so
 * is never a candidate for settled pruning: a draft that cannot say what it
 * is for cannot be safely deleted.
 *
 * @param {string} draftsDir the drafts directory
 * @returns {Map<string, string>} draft key ("owner/repo#42") to its directory
 */
export function draftedKeys(draftsDir) {
  const keys = new Map();
  let entries;

  try {
    entries = fs.readdirSync(draftsDir, { withFileTypes: true });
  } catch {
    return keys;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(draftsDir, entry.name);

    try {
      const { owner, repo, number } = JSON.parse(fs.readFileSync(path.join(dir, "review.json"), "utf8"));
      keys.set(draftKey(owner, repo, number), dir);
    } catch {
      // Not a draft this tool understands; leave it be.
    }
  }

  return keys;
}

/**
 * A pull request or issue's state, asked of GitHub.
 *
 * Pull requests and issues share the number space, and the issues endpoint
 * answers for both — a merged pull request reads as "closed", which is all
 * this caller needs to know.
 *
 * @param {string} key "owner/repo#42"
 * @returns {string} "open" or "closed"
 * @throws {Error} if gh cannot answer (network, auth, deleted repo)
 */
export function issueState(key) {
  const parts = key.match(KEY);

  if (!parts) throw new Error(`unusable key: ${key}`);

  return execFileSync(
    "gh",
    ["api", `repos/${parts[1]}/${parts[2]}/issues/${parts[3]}`, "--jq", ".state"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/**
 * Delete every draft whose pull request or issue is settled upstream: merged
 * or closed. The conversation those drafts belong to is over, whether or not
 * the reader got to them.
 *
 * A key whose state cannot be read is pruned NOT AT ALL and reported —
 * deleting an unread draft on a guess is the one unacceptable failure here.
 * An open item's draft is untouched.
 *
 * @param {string} draftsDir the drafts directory
 * @param {(key: string) => string} [state] answers "open" or "closed" for a
 *   key, throwing when it cannot; defaults to asking gh
 * @returns {{pruned: string[], failed: {key: string, error: string}[]}}
 */
export function pruneSettled(draftsDir, state = issueState) {
  const pruned = [];
  const failed = [];

  for (const [key, dir] of draftedKeys(draftsDir)) {
    let answer;

    try {
      answer = state(key);
    } catch (error) {
      failed.push({ key, error: error.message });
      continue;
    }

    if (answer !== "closed") continue;

    fs.rmSync(dir, { recursive: true, force: true });
    pruned.push(key);
  }

  return { pruned, failed };
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
  const [command, draftsDir] = process.argv.slice(2);

  if (command === "run" && draftsDir) {
    const pruned = pruneDrafts(draftsDir);

    console.log(JSON.stringify({ pruned, count: pruned.length }, null, 2));
  } else if (command === "settled" && draftsDir) {
    const { pruned, failed } = pruneSettled(draftsDir);

    console.log(JSON.stringify({ pruned, count: pruned.length, failed }, null, 2));
  } else {
    console.error("usage: prune-drafts.js run|settled <drafts-dir>");
    process.exit(1);
  }
}
