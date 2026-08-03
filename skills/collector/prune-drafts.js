#!/usr/bin/env node
// Delete drafts whose review is done with, so the drafts directory does not
// hold onto pull requests nobody will read about again.
//
//   prune-drafts.js run <drafts-dir>   delete finished drafts, print which ones
//
// "Done with" comes from the app's own sync log, not from age or from
// GitHub: a pull request is finished once its most recent `pulls`-collection
// event is "post" or "dismiss". A later "restore" undoes that, so the pull
// request goes back on the queue and its draft is left alone.

import fs from "node:fs";
import path from "node:path";

import { draftPath } from "./draft-path.js";

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
 * The pull requests whose review is done with: posted or dismissed, and not
 * since restored.
 *
 * A pull key's state is whatever its most recent `pulls`-collection event
 * says, across every device's log — not "has it ever had a post or dismiss
 * event". A restore after a dismiss puts it back on the queue.
 *
 * @param {object[]} events parsed sync-log events, any collection
 * @returns {Set<string>} pull keys ("owner/repo#42") safe to delete the draft for
 */
export function finishedPulls(events) {
  const latest = new Map();

  for (const event of events) {
    if (!event || event.collection !== "pulls") continue;
    if (typeof event.objectId !== "string" || typeof event.action !== "string") continue;
    if (typeof event.time !== "number") continue;

    const current = latest.get(event.objectId);

    if (!current || event.time > current.time) latest.set(event.objectId, { action: event.action, time: event.time });
  }

  const finished = new Set();

  for (const [key, { action }] of latest) {
    if (TERMINAL.has(action)) finished.add(key);
  }

  return finished;
}

/**
 * Delete every draft (and its media — qa.mp4, frames/, whatever sits beside
 * review.json) whose pull request is finished.
 *
 * Only removes files on disk. Committing and pushing the deletion is the
 * sweep's job, reusing the same "Sync to git" step a draft write already
 * goes through.
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

if (process.argv[1] === import.meta.filename) {
  const [command, draftsDir] = process.argv.slice(2);

  if (command === "run" && draftsDir) {
    const pruned = pruneDrafts(draftsDir);

    console.log(JSON.stringify({ pruned, count: pruned.length }, null, 2));
  } else {
    console.error("usage: prune-drafts.js run <drafts-dir>");
    process.exit(1);
  }
}
