#!/usr/bin/env node
// The review queue for the hourly "review-dry sweep" scheduled task.
//
//   queue.js next <drafts-dir> [limit]   print the review requests not yet drafted
//
// The collector owns no paths: the drafts directory is named by the reviewer's
// CLAUDE.md and handed in. The scheduled task session does the reviewing; this
// only tracks which pull requests it has already handled.

import { execFileSync } from "node:child_process";
import path from "node:path";

import { selectNew, revived, key, withinWorkspace, dedupe, splitByRules } from "./select-new.js";
import { readEvents, resolutions, postedReviews } from "./prune-drafts.js";
import { draftPath } from "./draft-path.js";
import { draftState } from "./draft-state.js";
import { findCheckouts, repoFromRemote, searchRoots, neighborhood } from "./resolve-repo.js";
import { searchArgs } from "./search-args.js";
import { readRules } from "./rules.js";

/**
 * The pull requests a draft already exists for, and the ones whose draft is
 * a claim its run never finished.
 *
 * The drafts directory is the record. A draft is named for its pull request, so
 * asking whether one has been reviewed is asking whether its file is there —
 * and whether the run that wrote it is still alive. A stale claim is a run that
 * died partway (see draft-state.js); its pull request is offered again, so the
 * reviewing skill can take the claim over instead of leaving it stranded.
 *
 * @param {string} drafts the drafts directory
 * @param {object[]} prs open review requests
 * @returns {{drafted: Set<string>, stale: string[]}} keys with a finished or
 *   live draft, and keys whose claim is dead
 */
function draftedAndStale(drafts, prs) {
  const drafted = new Set();
  const stale = [];

  for (const pr of prs) {
    const [owner, repo] = pr.repository.nameWithOwner.split("/");
    const relative = draftPath(owner, repo, pr.number).replace("drafts/", "");
    const state = draftState(path.join(drafts, path.dirname(relative)));

    if (state === "finished" || state === "live") drafted.add(key(pr));
    if (state === "stale") stale.push(key(pr));
  }

  return { drafted, stale };
}

/**
 * One `gh search prs` call.
 *
 * @param {string} qualifier e.g. "--review-requested=@me"
 * @returns {object[]} pull requests with number, title, repository, url, and
 *   the author, isDraft and labels the rules read
 */
function search(qualifier) {
  return JSON.parse(
    execFileSync("gh", searchArgs(qualifier), { encoding: "utf8" }),
  );
}

/**
 * Every open pull request the sweep should review: the ones awaiting this
 * user's review, and the user's own. Review requests come first; one that is
 * both appears once.
 *
 * @returns {object[]} pull requests with number, title, repository, url
 */
function openReviewRequests() {
  return dedupe(search("--review-requested=@me"), search("--author=@me"));
}

/**
 * The posted pull requests about to be drafted again whose head is still the
 * commit the review was posted at.
 *
 * A comment, a label or a CI run moves a pull request's updatedAt, but only a
 * new head is new code to review. A review that cannot be checked (no review
 * id in its url, or gh failing) counts as unchanged: the sweep never redrafts
 * on doubt, and reports the key in `failed`.
 *
 * @param {object[]} prs pull requests a dismissal no longer holds back
 * @param {Map<string, {url: (string|undefined), time: number}>} posted posted
 *   reviews, as prune-drafts' `postedReviews` folds them
 * @returns {{unchanged: Set<string>, failed: {key: string, reason: string}[]}}
 */
function unchangedSincePost(prs, posted) {
  const unchanged = new Set();
  const failed = [];

  for (const pr of prs) {
    const review = posted.get(key(pr));
    if (!review) continue;

    const repo = pr.repository.nameWithOwner;
    const id = /#pullrequestreview-(\d+)$/.exec(review.url || "")?.[1];

    try {
      if (!id) throw new Error(`no review id in ${review.url || "the posted url"}`);

      const gh = (route, jq) =>
        execFileSync("gh", ["api", route, "--jq", jq], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const reviewed = gh(`repos/${repo}/pulls/${pr.number}/reviews/${id}`, ".commit_id");
      const head = gh(`repos/${repo}/pulls/${pr.number}`, ".head.sha");

      if (!reviewed || !head) throw new Error("no commit for the review or the head");
      if (reviewed === head) unchanged.add(key(pr));
    } catch (error) {
      unchanged.add(key(pr));
      failed.push({ key: key(pr), reason: error.message.split("\n")[0] });
    }
  }

  return { unchanged, failed };
}

const [command, draftsDir, limit] = process.argv.slice(2);

if (command === "next" && draftsDir) {
  // A review request for something not checked out around here is not this
  // sweep's business: there would be nothing to review it against.
  const repos = findCheckouts(searchRoots(process.env, neighborhood(process.cwd())))
    .map((dir) => {
      try {
        return repoFromRemote(
          execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }),
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // A rules file that is not understood in full is refused whole: everything
  // is drafted, nothing is skipped, and the error is printed.
  let rules = [];
  let rulesError;

  try {
    rules = readRules(draftsDir);
  } catch (error) {
    rulesError = error.message;
  }

  // Skipped pull requests leave before the limit applies, so they never eat it.
  const { kept: scoped, skipped } = splitByRules(
    withinWorkspace(openReviewRequests(), repos),
    rules,
  );

  // The sync log keeps the selector honest after a prune: a pull the reader
  // posted on or dismissed is not fresh just because its draft is gone.
  // A posted pull comes back only for a new head, not for a comment or label.
  const { drafted, stale } = draftedAndStale(draftsDir, scoped);
  const events = readEvents(draftsDir);
  const resolved = resolutions(events);
  const { unchanged, failed: postedCheckFailed } = unchangedSincePost(
    revived(scoped, resolved).filter((pr) => !drafted.has(key(pr))),
    postedReviews(events),
  );
  const { fresh, deferred } = selectNew(scoped, drafted, Number(limit) || 4, resolved, unchanged);

  console.log(
    JSON.stringify(
      {
        fresh: fresh.map((pr) => ({
          key: key(pr),
          repo: pr.repository.nameWithOwner,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author?.login,
          action: pr.action,
        })),
        deferredCount: deferred.length,
        deferred: deferred.map(key),
        skipped: skipped.map(key),
        stale,
        unchangedSincePost: [...unchanged],
        ...(postedCheckFailed.length ? { postedCheckFailed } : {}),
        ...(rulesError ? { rulesError } : {}),
      },
      null,
      2,
    ),
  );
} else {
  console.error("usage: queue.js next <drafts-dir> [limit]");
  process.exit(1);
}
