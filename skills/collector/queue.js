#!/usr/bin/env node
// The review queue for the hourly "review-dry sweep" scheduled task.
//
//   queue.js next <drafts-dir> [limit]   print the review requests not yet drafted
//
// The collector owns no paths: the drafts directory is named by the reviewer's
// CLAUDE.md and handed in. The scheduled task session does the reviewing; this
// only tracks which pull requests it has already handled.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { selectNew, key, withinWorkspace, dedupe } from "./select-new.js";
import { readEvents, resolutions } from "./prune-drafts.js";
import { draftPath } from "./draft-path.js";
import { findCheckouts, repoFromRemote, searchRoots, neighborhood } from "./resolve-repo.js";

/**
 * The pull requests a draft already exists for.
 *
 * The drafts directory is the record. A draft is named for its pull request, so
 * asking whether one has been reviewed is asking whether its file is there.
 *
 * @param {string} drafts the drafts directory
 * @param {object[]} prs open review requests
 * @returns {Set<string>} keys of the pull requests already drafted
 */
function alreadyDrafted(drafts, prs) {
  const drafted = new Set();

  for (const pr of prs) {
    const [owner, repo] = pr.repository.nameWithOwner.split("/");
    const relative = draftPath(owner, repo, pr.number).replace("drafts/", "");

    if (fs.existsSync(path.join(drafts, relative))) drafted.add(key(pr));
  }

  return drafted;
}

/**
 * One `gh search prs` call.
 *
 * @param {string} qualifier e.g. "--review-requested=@me"
 * @returns {object[]} pull requests with number, title, repository, url
 */
function search(qualifier) {
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "search", "prs",
        qualifier,
        "--state=open",
        "--limit", "40",
        "--json", "number,title,repository,url,updatedAt",
      ],
      { encoding: "utf8" },
    ),
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

  const scoped = withinWorkspace(openReviewRequests(), repos);

  // The sync log keeps the selector honest after a prune: a pull the reader
  // posted on or dismissed is not fresh just because its draft is gone.
  const { fresh, deferred } = selectNew(
    scoped,
    alreadyDrafted(draftsDir, scoped),
    Number(limit) || 4,
    resolutions(readEvents(draftsDir)),
  );

  console.log(
    JSON.stringify(
      {
        fresh: fresh.map((pr) => ({
          key: key(pr),
          repo: pr.repository.nameWithOwner,
          number: pr.number,
          title: pr.title,
          url: pr.url,
        })),
        deferredCount: deferred.length,
        deferred: deferred.map(key),
      },
      null,
      2,
    ),
  );
} else {
  console.error("usage: queue.js next <drafts-dir> [limit]");
  process.exit(1);
}
