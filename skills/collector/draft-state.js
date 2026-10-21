import fs from "node:fs";
import path from "node:path";

// How long a claim may go untouched before its run is taken for dead. The
// reviewing skill applies the same figure when it decides to overwrite one.
export const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * The newest modification time under a folder, recursing into subfolders.
 *
 * @param {string} dir a directory
 * @returns {number} milliseconds since the epoch, 0 for an empty folder
 */
function newestMtime(dir) {
  let newest = 0;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(file) : fs.statSync(file).mtimeMs;

    if (mtime > newest) newest = mtime;
  }

  return newest;
}

/**
 * What a draft folder holds, as far as the sweep is concerned.
 *
 * A run can die at any point — the machine sleeps, the network drops, the
 * power goes — and the claim it wrote stays on disk looking like work in
 * progress. Only a `finishedAt` means done. Anything else is live while
 * something in the folder is still being written (QA writes frames and a
 * recording beside review.json for as long as it runs), and stale once nothing
 * has moved for `STALE_AFTER_MS`. A review.json that will not parse is a write
 * the power cut short, and is judged by the same clock.
 *
 * @param {string} dir the draft's directory
 * @param {number} [now] milliseconds since the epoch
 * @returns {"none" | "finished" | "live" | "stale"}
 */
export function draftState(dir, now = Date.now()) {
  let text;

  try {
    text = fs.readFileSync(path.join(dir, "review.json"), "utf8");
  } catch {
    return "none";
  }

  try {
    if (JSON.parse(text).finishedAt) return "finished";
  } catch {
    // Cut off mid-write: unfinished, and the clock decides below.
  }

  return now - newestMtime(dir) < STALE_AFTER_MS ? "live" : "stale";
}
