# Install

Two skills that draft code reviews and post nothing. Everything they need is in this file, so there is nothing else to fetch.

**Reading this as an agent?** Write each block below to the path above it, exactly as it is. Then tell the reader which skills are installed and what to set as their drafts directory.

**Reading this yourself?** Same thing: each fenced block is one file, and the line above it says where it goes.

You need the `gh` CLI, authenticated, and node. Nothing here posts to GitHub, and nothing here needs a token of ours, because there is no account to have.

## The skills

### `~/.claude/skills/dev-review/SKILL.md`

Drafts one pull request into the schema.

````markdown
---
name: dev-review
description: Write the review's result as a JSON draft file. Unattended — never asks a question, never posts to GitHub. Use from the review sweep.
---

# dev-review

If you need to reach for a tool to check files to "review" code, YOU MUST STOP and let the reviewer know that you are not the code expert. YOU MUST HAVE AN EXISTING CONTEXT THAT DOES THE ACTUAL REVIEWING.

Nobody is watching. Never ask a question, never wait for a go-ahead, and **never post anything to GitHub** — a human reads the file later, and posting is their call.

## First action: claim the file

FIRST: Write the placeholder to:

```text
<drafts directory>/<owner>--<repo>-<number>/review.json
```

`org/app#42` becomes `org--app-42/review.json`. When no drafts directory was handed to you, use the one your CLAUDE.md names as your drafts directory.

Store all media related to this (videos, screenshots) in the same directory.

```json
{ "schema": 3, "owner": "…", "repo": "…", "number": 0, "verdict": "COMMENT",
  "summary": "Reviewing…", "progress": { "note": "Claimed — review starting", "percent": 0 },
  "comment": "A review of this pull request is being written." }
```

**If the file already exists, stop — with one exception.** An existing draft means another run owns this pull request or a human already has the review; a second reviewer would fight it over the same file. The exception is a dead claim: a file with no `finishedAt` that has not been modified in over 30 minutes is a run that died partway. Overwrite it with your own placeholder and take the review over.

## Write as you go

As review input comes in, keep `org--app-42/review.json` up-to-date so the human stays in the loop.

1. **After each lens completes**, overwrite the file with everything so far — sections and findings accumulated to that point, `draftedAt` refreshed, and `progress` updated: `{ "note": "Security review", "percent": 60 }`. Write the note for the human waiting ("Reading the diff", "QA: scenario 2 of 3"), not as an internal state code.
2. **Finish** by writing the complete draft with `finishedAt` set (ISO 8601). `finishedAt` is the one signal the app trusts to mean done — never set it on an intermediate write, never leave it off the final one. Everything before it, the app shows as work in progress; posting stays locked until it appears.

## The finished draft

```json
{
  "schema": 3,
  "owner": "org",
  "repo": "app",
  "number": 42,
  "title": "Re-root the Records errors",
  "url": "https://github.com/org/app/pull/42",
  "reviewedAt": "e612b1b",
  "draftedAt": "2026-07-29T15:36:52Z",
  "finishedAt": "2026-07-29T15:41:10Z",
  "verdict": "APPROVE | COMMENT | REQUEST_CHANGES",
  "summary": "One line about the change itself. No QA tallies — the qa block is that evidence.",
  "sections": [
    { "key": "data-migrations", "label": "Data & migrations", "color": "ok", "body": "Checked the backfill for batching and a reversible down — both fine." },
    { "key": "correctness", "label": "Correctness", "color": "warn", "body": "One racy dedup, flagged inline." },
    { "key": "tests-conventions", "label": "Tests & conventions", "color": "ok", "body": "Specs ported with the move; edge cases covered." },
    { "key": "security-api", "label": "Security & API", "color": "ok", "body": "No trust boundary touched." }
  ],
  "kinds": [
    { "key": "robustness", "body": "Holds under sequential use; concurrency is the open question." }
  ],
  "findings": [
    {
      "id": "racy-idempotent-link",
      "section": "correctness",
      "path": "lib/org/records/error.rb",
      "line": 12,
      "kind": "robustness",
      "color": "warn",
      "body": "Markdown. Posted as an inline comment on that line. Be brief.",
      "suggestion": "the exact replacement for that line — present on every finding a line edit can express\n"
    }
  ],
  "qa": {
    "note": "Applied a discount to an order through the UI and re-applied it; the DB showed one link each time.",
    "scenarios": [
      {
        "id": "remove-member",
        "url": "/account/members",
        "what": "One line: what this proves.",
        "verdict": "pass | fail | skip",
        "video": "org--app-42/run.mp4",
        "frames": 6,
        "durationMs": 4200
      }
    ]
  },
  "comment": "Markdown. Terse. This is the review body."
}
```

The parts that are easy to get wrong:

- Be terse in comments and summary and follow PR etiquette. No need to explain what the PR does in the `summary` or repeat what comments state – just the review outcome.
- `verdict` is used verbatim as the GitHub review event. Nothing reads it back out of prose.
- `kinds` carries a one-line `body` for each coined finding kind. The app shows them as THEMES filters; a kind with no entry still filters, it just has nothing to say about itself.
- `findings` each need a unique `id`, a `path`, a `line`, and a `body`. Most important first. Their `kind` is a coined slug (`transition-debt`, `lock-risk`) — never a generic `bug`. Make potent groupings.
- `line` must be a line the diff actually touches, or GitHub refuses the comment.
- `color` — on sections and findings alike — is a named token: `neutral`, `ok`, `warn`, `critical` or `accent`. The app maps names onto its own palette; an unrecognised name degrades to `neutral`.
- `progress.percent` is 0–100 and optional; `progress` as a whole is ignored once `finishedAt` is set.
- `video` is stored in `org--app-42/` and must stay inside it. A path that climbs out is refused.
- A scenario with no `verdict` counts as `skip`. Silence is not a pass.
- `comment` is the body of the review, not the whole review. Keep the findings out of it. If something is related to a diff, use `findings`. Otherwise, use the main `comment`.
````

### `~/.claude/skills/dev-review-sweep/SKILL.md`

Finds what is waiting and runs the first over each.

````markdown
---
name: dev-review-sweep
description: Find the pull requests awaiting your or your team's review, including your own, and get each one drafted through dev-review so they can be read later in the reviewer app. Unattended — never asks, never posts to GitHub. Use on the hourly sweep or when asked to sweep the review queue.
---

Find the pull requests awaiting your or your team's review, including your own. Get each one drafted, so they can be read later in the reviewer app.

The queue tooling lives in this skill. It owns no paths — hand it the drafts directory your CLAUDE.md names:

```bash
node ~/.claude/skills/dev-review-sweep/collector/queue.js next <drafts-dir> [limit]   # pull requests with no draft yet, plus what got deferred
```

For each fresh PR, pipe your review flow into **/dev-review**.

Hand the reviewing skill the `unattended` QA mode: nobody is waiting to be asked, so it runs its checkpoints without confirming — not without running them. A sweep that comes back with "QA skipped, unattended" has not done the job.

You're unattended: never ask a question, never wait for a go-ahead. If one pull request fails, say why and carry on to the next. HOWEVER, THE RULES DON'T CHANGE JUST BECAUSE YOU'RE "DOING A SWEEP." Never use a "sweep" as an excuse.

## Never write to GitHub

No `gh pr comment`, `gh pr review`, `gh pr merge`, or anything else that posts. The deliverable is a local draft a person reads; posting is their call, made in the app.

## Finish with

One short paragraph: what you drafted, how many were deferred and which, and anything that failed and why. Never let the cap pass silently.
````

## The queue helper

The sweep asks this which pull requests have no draft yet. The four modules import each other by relative path, so they belong in `~/.claude/skills/dev-review-sweep/collector/` together.

### `~/.claude/skills/dev-review-sweep/collector/queue.js`

```javascript
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
        "--json", "number,title,repository,url",
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

  const { fresh, deferred } = selectNew(scoped, alreadyDrafted(draftsDir, scoped), Number(limit) || 4);

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
```

### `~/.claude/skills/dev-review-sweep/collector/select-new.js`

```javascript
/**
 * Identity of a pull request in the seen-state file.
 *
 * @param {object} pr a pull request from `gh search prs --json`
 * @returns {string} "owner/repo#number"
 */
export function key(pr) {
  return `${pr.repository.nameWithOwner}#${pr.number}`;
}

/**
 * Merge pull request lists, keeping the first appearance of each.
 *
 * The queue is two searches — review requests and the user's own pull
 * requests — and one asking for a review of your own work is in both.
 *
 * @param {...object[]} lists pull requests, in priority order
 * @returns {object[]} one entry per pull request
 */
export function dedupe(...lists) {
  const seen = new Set();
  const merged = [];

  for (const pr of lists.flat()) {
    if (seen.has(key(pr))) continue;

    seen.add(key(pr));
    merged.push(pr);
  }

  return merged;
}

/**
 * Split the open review requests into the ones still needing a draft and the
 * ones this sweep is deferring to the next hour.
 *
 * A pull request is fresh until a draft exists for it; the sweep does not
 * re-draft on later pushes or comments. Nothing records what has been drafted —
 * the drafts are that record.
 *
 * @param {object[]} prs open review requests
 * @param {Set<string>} drafted keys of pull requests a draft already exists for
 * @param {number} limit most pull requests to draft in one sweep
 * @returns {{fresh: object[], deferred: object[]}}
 */
export function selectNew(prs, drafted, limit) {
  const undrafted = prs.filter((pr) => !drafted.has(key(pr)));

  return { fresh: undrafted.slice(0, limit), deferred: undrafted.slice(limit) };
}

/**
 * Keep only the pull requests belonging to a workspace's repositories.
 *
 * A workspace is a directory, and its repositories are whatever checkouts were
 * found under it. A review request for something not checked out there is not
 * this workspace's business — there would be nothing to review it against.
 *
 * @param {object[]} prs open review requests
 * @param {string[]} repos "owner/name" of every repository in the workspace
 * @returns {object[]} the pull requests this workspace can review
 */
export function withinWorkspace(prs, repos) {
  const known = new Set(repos.map((repo) => repo.toLowerCase()));

  return prs.filter((pr) => known.has(pr.repository.nameWithOwner.toLowerCase()));
}
```

### `~/.claude/skills/dev-review-sweep/collector/draft-path.js`

```javascript
// Where a draft lives, derived rather than looked up.
//
// The sweep writes one markdown file per pull request it has reviewed. Nothing
// lists them: the queue comes from GitHub, and the client asks for the file it
// expects for each pull request in that queue. A 404 means the sweep has not
// reached it yet.

// GitHub owners and repository names are drawn from this set. Anything else did
// not come from the API, and must not reach a URL path.
const NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Assert that a value can be placed in a draft filename.
 *
 * @param {string} value an owner or repository name
 * @returns {string} the value, unchanged
 * @throws {Error} if the value is not a plain GitHub name
 */
function name(value) {
  if (typeof value !== "string" || !NAME.test(value) || value === "." || value === "..") {
    throw new Error(`unusable name: ${value}`);
  }

  return value;
}

/**
 * Assert that a value is a pull request number.
 *
 * @param {number} value the pull request number
 * @returns {number} the value, unchanged
 * @throws {Error} if the value is not a positive integer
 */
function number(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`unusable number: ${value}`);
  }

  return value;
}

/**
 * Path, relative to the served root, of the draft for a pull request.
 *
 * Each pull request owns a directory, so its media (QA recordings, frames)
 * lives beside the draft rather than in a shared pile.
 *
 * @param {string} owner the repository owner, e.g. "org"
 * @param {string} repo the repository name, e.g. "app"
 * @param {number} pull the pull request number
 * @returns {string} e.g. "drafts/org--app-42/review.json"
 * @throws {Error} if any part could walk out of the drafts directory
 */
export function draftPath(owner, repo, pull) {
  return `drafts/${name(owner)}--${name(repo)}-${number(pull)}/review.json`;
}

/**
 * Identity of a pull request, matching the sweep's seen-state keys.
 *
 * @param {string} owner the repository owner
 * @param {string} repo the repository name
 * @param {number} pull the pull request number
 * @returns {string} e.g. "org/app#42"
 */
export function draftKey(owner, repo, pull) {
  return `${name(owner)}/${name(repo)}#${number(pull)}`;
}
```

### `~/.claude/skills/dev-review-sweep/collector/resolve-repo.js`

```javascript
#!/usr/bin/env node

// Resolve a GitHub repository to a checkout already on this machine, so the
// sweep can review where the code already lives instead of cloning it again.
//
//   resolve-repo.js owner/name   -> /path/to/local/checkout
//
// Exits 1 with no output when there is no local checkout.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Where to look for checkouts.
 *
 * Directory names do not match repository names, so every candidate is
 * identified by its origin remote rather than by its path; this only decides
 * which directories are worth listing at all. REVIEWER_CHECKOUTS overrides
 * the fallback, for reviewing away from the checkouts.
 *
 * @param {Object<string,string>} env the environment to read
 * @param {string} fallback the directory to search when nothing is configured
 * @returns {string[]} directories to list
 */
export function searchRoots(env, fallback) {
  const configured = (env.REVIEWER_CHECKOUTS || "").split(":").filter((root) => root.trim());

  return configured.length ? configured : [fallback];
}

/**
 * The folder of checkouts a directory belongs to.
 *
 * Working inside a checkout, the repositories worth searching are its
 * neighbors — the folder holding it. Anywhere else, the directory itself is
 * the place to look.
 *
 * @param {string} dir the directory to start from
 * @returns {string} the folder to search for checkouts
 */
export function neighborhood(dir) {
  return fs.existsSync(path.join(dir, ".git")) ? path.dirname(dir) : dir;
}

const SEARCH_ROOTS = searchRoots(process.env, neighborhood(process.cwd()));

/**
 * The "owner/name" a git remote points at, if it is a GitHub remote.
 *
 * @param {string} url an origin url, ssh or https
 * @returns {string|null} lowercased "owner/name", or null if not GitHub
 */
export function repoFromRemote(url) {
  const match = String(url)
    .trim()
    .match(/^(?:git@github\.com:|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+)\/(.+?)(?:\.git)?$/i);

  return match ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}` : null;
}

/**
 * The local checkout for a repository, chosen deterministically when more than
 * one directory points at the same remote.
 *
 * @param {string} repo "owner/name" from the GitHub API
 * @param {{path: string, remote: string}[]} candidates local checkouts
 * @returns {string|null} the checkout path, or null when none match
 */
export function pickLocalRepo(repo, candidates) {
  const wanted = repo.toLowerCase();
  const matches = candidates
    .filter((candidate) => repoFromRemote(candidate.remote) === wanted)
    .map((candidate) => candidate.path)
    .sort();

  return matches[0] || null;
}

// Directories that never hold a project checkout, and can hold thousands of
// files. Descending into them is the difference between a scan and a crawl.
const SKIP = new Set(["node_modules", "vendor", "tmp", "log", "target", "dist", "build"]);

// How far below a root to look. Deep enough for a repository filed under a
// couple of grouping folders, shallow enough that a mistaken root does not walk
// a whole home directory.
const MAX_DEPTH = 5;

/**
 * Every git checkout at or below the given folders.
 *
 * A directory holding `.git` is a checkout, and the walk does not descend into
 * one: a repository's own vendored copies and worktrees are not separate
 * projects. Hidden and dependency directories are skipped outright.
 *
 * @param {string[]} roots folders to search
 * @param {{maxDepth?: number}} [options] how far below each root to look
 * @returns {string[]} absolute paths of checkouts, each reported once
 */
export function findCheckouts(roots, options = {}) {
  const limit = options.maxDepth ?? MAX_DEPTH;
  const seen = new Set();

  const walk = (dir, depth) => {
    if (depth > limit) return;

    if (fs.existsSync(path.join(dir, ".git"))) {
      seen.add(fs.realpathSync(dir));

      return;
    }

    let entries = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;

      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }

  return [...seen];
}

/**
 * Every local checkout, with its origin remote.
 *
 * @returns {{path: string, remote: string}[]} local checkouts
 */
export function localCheckouts() {
  return findCheckouts(SEARCH_ROOTS).flatMap((dir) => {
    try {
      const remote = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      return [{ path: dir, remote }];
    } catch {
      return [];
    }
  });
}

if (process.argv[1] === import.meta.filename) {
  const wanted = process.argv[2] || "";
  const resolved = pickLocalRepo(wanted, localCheckouts());

  if (!resolved) {
    // Say where we looked. The common cause is a correct repository and a
    // search root that no longer holds the checkouts, which is indistinguishable
    // from "no checkout exists" unless we name the roots.
    console.error(
      `resolve-repo: no checkout of ${wanted} under ${SEARCH_ROOTS.join(", ")}\n` +
        "set REVIEWER_CHECKOUTS to the directory holding your checkouts",
    );
    process.exit(1);
  }

  console.log(resolved);
}
```

## After installing

Name a drafts directory in your `CLAUDE.md`, and point a source in the app at the same directory. The sweep writes there and the app reads there; that is the whole integration.

Run `/dev-review-sweep` to draft what is waiting on you, then open the app to read it. What reaches GitHub is what you send.
