# Install

Two skills that draft code reviews, and post one only where your rules file says so. Everything they need is in this file, so there is nothing else to fetch.

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
  "title": "…", "url": "https://github.com/…/pull/0", "author": "…",
  "summary": "Reviewing…", "progress": { "note": "Claimed — review starting", "percent": 0 },
  "comment": "A review of this pull request is being written." }
```

`title`, `url` and `author` are load-bearing from the first write: the queue is the drafts directory, so the app knows nothing about a pull request except what the draft says, and a draft with no `url` renders nowhere.

Then leave the storage synced — see the section below.

**If the file already exists, stop — with one exception.** An existing draft means another run owns this pull request or a human already has the review; a second reviewer would fight it over the same file. The exception is a dead claim: a file with no `finishedAt` that has not been modified in over 30 minutes is a run that died partway. Overwrite it with your own placeholder and take the review over.

## Write as you go

As review input comes in, keep `org--app-42/review.json` up-to-date so the human stays in the loop.

1. **The moment a finding is identified**, write it in — don't hold it until its lens finishes or batch it with others. A human reading mid-review sees what is here now, not what was here as of the last checkpoint.
2. **After each lens completes** too, overwrite the file with everything so far — sections and findings accumulated to that point, `draftedAt` refreshed, and `progress` updated: `{ "note": "Security review", "percent": 60 }`. Write the note for the human waiting ("Reading the diff", "QA: scenario 2 of 3"), not as an internal state code.
3. **Before QA starts**, write and sync once more regardless of whether anything changed since the last write. QA is usually the slowest part of a review — a human should never be looking at a draft that is behind by everything QA takes to run, when every finding QA doesn't touch was already sitting there finished.
4. **Finish** by writing the complete draft with `finishedAt` set (ISO 8601). `finishedAt` is the one signal the app trusts to mean done — never set it on an intermediate write, never leave it off the final one. Everything before it, the app shows as work in progress; posting stays locked until it appears.

**Every timestamp is read from the clock, never composed.** Run `date -u +%Y-%m-%dT%H:%M:%SZ` and paste what it prints as `draftedAt` and `finishedAt`. A time typed from memory drifts into the future, and the app compares these stamps against the reader's decisions — a future stamp made their dismissals impossible to keep. A suspiciously round time like `15:25:00Z` is the tell.

Leave the storage synced after each of these writes too — same section below.

## Leave the storage synced

A write is not done until whatever reads the drafts directory can see it. Most storage needs nothing from you: a plain folder, a bucket, or a repository the app reads directly is current the moment the file lands. A drafts directory that is a git checkout with a remote is the one kind that waits for a push, so after every write to `review.json` — the claim, each progress update, and the finished draft:

1. Check `git -C <drafts directory> rev-parse --is-inside-work-tree` succeeds and `git -C <drafts directory> remote` lists something. If either fails, this is not that kind of storage — do nothing.
2. Otherwise `git -C <drafts directory> add -A` (this respects `.gitignore` — never force-add an ignored file, e.g. `qa.mp4` or `frames/`), commit with a small mechanical message like `Update review draft: org/repo#42`, and push.
3. If the push is rejected, pull/rebase once and retry. If it still fails, don't crash the review — note the sync failure in your final summary instead.

Never touch git config. Never force-push. Never ask.

## The finished draft

```json
{
  "schema": 3,
  "owner": "org",
  "repo": "app",
  "number": 42,
  "title": "Re-root the Records errors",
  "url": "https://github.com/org/app/pull/42",
  "author": "priya",
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
- **One scenario entry per QA run — one scenario file, one recording.** A run that checks five things is still one entry; listing its checkpoints as separate scenarios makes the app play the same video once per entry. No two entries share a `video`. Several entries mean several runs, each recording copied in under its own name: the runner always writes `qa.mp4`, so a second run left at that name overwrites the first.
- A scenario with no `verdict` counts as `skip`. Silence is not a pass.
- `comment` is the body of the review, not the whole review, and it defaults to empty. Leave it `""` unless there is something to say that cannot be pinned to a line — everything that can be, goes in `findings` instead, never repeated here as prose. An empty `comment` reads to the reviewer as "the findings carry this review," which is a fine review; do not fill it with a restatement of what the findings already say just to have something written there.
````

### `~/.claude/skills/dev-review-sweep/SKILL.md`

Finds what is waiting and runs the first over each.

````markdown
---
name: dev-review-sweep
description: Find the pull requests awaiting your or your team's review, including your own, and get each one drafted through dev-review so they can be read later in the reviewer app. Unattended: never asks, and posts to GitHub only where the reader's rules file says so. Use on the hourly sweep or when asked to sweep the review queue.
---

Find the pull requests awaiting your or your team's review, including your own. Get each one drafted, so they can be read later in the reviewer app.

The queue tooling lives in this skill. It owns no paths — hand it the drafts directory your CLAUDE.md names:

```bash
node ~/.claude/skills/dev-review-sweep/collector/queue.js next <drafts-dir> [limit]   # pull requests with no draft yet, plus what got deferred
```

It skips what already has a draft, and also what the sync log says the reader already posted or dismissed — so pruning a handled draft never gets it redrafted. A dismissed pull request comes back only once it has moved since the dismissal; a posted one only when the reader clears it in the app.

For each fresh PR, pipe your review flow into **/dev-review**.

Hand the reviewing skill the `unattended` QA mode: nobody is waiting to be asked, so it runs its checkpoints without confirming — not without running them. A sweep that comes back with "QA skipped, unattended" has not done the job.

You're unattended: never ask a question, never wait for a go-ahead. If one pull request fails, say why and carry on to the next. HOWEVER, THE RULES DON'T CHANGE JUST BECAUSE YOU'RE "DOING A SWEEP." Never use a "sweep" as an excuse.

## The rules file

The reader decides ahead of time what the sweep does with a pull request. The rules live in `rules.json` in the drafts directory:

```json
{ "rules": [ { "when": { "author": "someone" }, "then": "post" } ] }
```

A rule has a `when` and a `then`. The conditions in `when` are `author`, `repo` ("owner/name"), `verdict`, `label` (one label or a list, any of which matches, in any letter case) and `isDraft` (true or false). Every condition in a rule must hold. A fact that is not known never satisfies a condition.

The `then` is one of three actions. `post` drafts the review and then posts it. `skip` leaves the pull request out of the sweep. `draft` drafts the review and leaves it for the reader. The first rule that matches wins. A pull request that no rule matches gets `draft`. No rules file means no rules.

The queue applies the rules. Each fresh entry carries its `author` and its `action`, and `skipped` lists the keys a rule left out. The `action` is provisional, because no verdict exists before drafting. An `action` of `post` means a rule posts this pull request under at least one verdict.

A rules file that is not understood in full is refused whole. The queue prints `rulesError` with the reason, every pull request gets `draft`, nothing is skipped, and nothing is posted.

## Write to GitHub through post.js only

The sweep writes to GitHub through `post.js` and nothing else. `gh pr comment`, `gh pr review`, `gh pr merge` and anything else that posts stay forbidden.

After /dev-review finishes a draft whose queue `action` was `post`, run post.js for that key:

```bash
node ~/.claude/skills/dev-review-sweep/collector/post.js run <drafts-dir> <owner/repo#n>   # post the finished draft if a rule says so, print what happened
```

It prints `{ "posted": { key, url, event } }` or `{ "refused": { key, reason } }`. It records a post in the sync log, so the app and the prune step see the draft as posted.

post.js decides, not the sweep. It checks the rules again, against the finished draft and the live pull request, and refuses unless a rule says `post`. A refusal is a normal outcome. It leaves the draft for the reader, and you report it with its reason. Never retry a refusal, never work around one, and never post a draft that post.js refused. Never run post.js for a draft whose queue `action` was `draft`.

A `logError` in the output means the review is out but the sync log is behind. Report it prominently, because the app still shows that draft as not posted.

## After every fresh PR is drafted: prune finished ones

A draft's reviewer app already knows when its review was posted or dismissed — that is what the sync log is for. A draft written after that word — the redraft of a dismissed pull request that came back — is spared, so pruning right after drafting never eats this sweep's own work. Once the fresh PRs above are drafted, clear out the drafts that are done with:

```bash
node ~/.claude/skills/dev-review-sweep/collector/prune-drafts.js run <drafts-dir>       # delete drafts posted or dismissed, print which ones
node ~/.claude/skills/dev-review-sweep/collector/prune-drafts.js settled <drafts-dir>   # delete drafts merged or closed upstream, print which and what failed
```

The second pass asks GitHub: a merged or closed pull request or issue is done with, drafted or not — even one the reader has unposted decisions on, because that conversation is over — so its draft goes too. A state that cannot be read prunes nothing for that key; it comes back in `failed`, and you report it rather than swallow it.

These delete matching draft folders (and their QA media) from disk only. Leave the storage synced the same way a draft write does: run the "Leave the storage synced" step from **/dev-review** against `<drafts-dir>` rather than a second flow of your own. On anything but a git-backed drafts directory that step does nothing, which is correct — the deletion is already visible.

## Finish with

One short paragraph: what you drafted, what was posted (with URLs), what post.js refused and why, what was skipped by rule, any `rulesError`, any `logError`, how many were deferred and which, how many drafts were pruned as posted, dismissed, or settled upstream, and anything that failed and why — a key whose state could not be read included — including any storage sync failure /dev-review or the prune step reported. Never let the cap pass silently.
````

## The queue helper

The sweep asks this which pull requests have no draft yet, and posts through it where the reader's rules say so. The modules import each other by relative path, so they belong in `~/.claude/skills/dev-review-sweep/collector/` together.

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

import { selectNew, key, withinWorkspace, dedupe, splitByRules } from "./select-new.js";
import { readEvents, resolutions } from "./prune-drafts.js";
import { draftPath } from "./draft-path.js";
import { findCheckouts, repoFromRemote, searchRoots, neighborhood } from "./resolve-repo.js";
import { searchArgs } from "./search-args.js";
import { readRules } from "./rules.js";

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
          author: pr.author?.login,
          action: pr.action,
        })),
        deferredCount: deferred.length,
        deferred: deferred.map(key),
        skipped: skipped.map(key),
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
```

### `~/.claude/skills/dev-review-sweep/collector/select-new.js`

```javascript
import { actionFor } from "./rules.js";

// The verdicts a finished draft can carry.
const VERDICTS = ["APPROVE", "COMMENT", "REQUEST_CHANGES"];

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
 * The sync log's word holds even after the draft is pruned: a posted pull is
 * never re-drafted (reviewing it again is the reader's gesture, in the app),
 * and a dismissed one only once it has moved since the dismissal — the same
 * revival rule the app applies.
 *
 * @param {object[]} prs open review requests
 * @param {Set<string>} drafted keys of pull requests a draft already exists for
 * @param {number} limit most pull requests to draft in one sweep
 * @param {Map<string, {action: string, time: number}>} [resolved] terminal
 *   resolutions from the sync log, as prune-drafts' `resolutions` folds them
 * @returns {{fresh: object[], deferred: object[]}}
 */
export function selectNew(prs, drafted, limit, resolved = new Map()) {
  const undrafted = prs.filter((pr) => !drafted.has(key(pr)) && !handled(pr, resolved.get(key(pr))));

  return { fresh: undrafted.slice(0, limit), deferred: undrafted.slice(limit) };
}

/**
 * Whether the log already answers this pull request.
 *
 * @param {object} pr a pull request from `gh search prs --json`
 * @param {{action: string, time: number}} [resolution] how its review ended
 * @returns {boolean} whether drafting it would ask an answered question
 */
function handled(pr, resolution) {
  if (!resolution) return false;
  if (resolution.action === "post") return true;

  // The search's ISO string against the log's millisecond clock; a missing
  // or unparsable updatedAt is NaN, which never reads as newer.
  return !(Date.parse(pr.updatedAt || "") > resolution.time);
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

/**
 * Split the pull requests by what the reader's rules say before any draft
 * exists: the ones a rule skips, and the ones to carry on with.
 *
 * The action is provisional. No verdict exists yet, so "post" means some
 * verdict would post; post.js checks again against the finished draft.
 *
 * @param {object[]} prs pull requests from `gh search prs --json`
 * @param {object[]} rules the reader's rules, as `readRules` returns them
 * @returns {{kept: object[], skipped: object[]}} `kept` are copies carrying
 *   their `action`, "post" or "draft"
 */
export function splitByRules(prs, rules) {
  const kept = [];
  const skipped = [];

  for (const pr of prs) {
    const facts = {
      author: pr.author?.login,
      repo: pr.repository.nameWithOwner,
      labels: (pr.labels || []).map((label) => label.name),
      isDraft: pr.isDraft,
    };

    if (actionFor(rules, facts) === "skip") {
      skipped.push(pr);
      continue;
    }

    const mayPost = [undefined, ...VERDICTS].some(
      (verdict) => actionFor(rules, { ...facts, verdict }) === "post",
    );

    kept.push({ ...pr, action: mayPost ? "post" : "draft" });
  }

  return { kept, skipped };
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

### `~/.claude/skills/dev-review-sweep/collector/prune-drafts.js`

```javascript
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
// undoes that. A draft written after that terminal event is a redraft — the
// queue re-offers a dismissed pull request once it moves — and is left alone.
// `settled` asks GitHub: a merged or closed pull request or issue is over
// regardless of what the reader did about its draft.

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
 * Whether the draft in `dir` was written after `time`.
 *
 * A draft newer than the post or dismiss it would be pruned for is not the
 * draft that post or dismiss answered: the queue re-offers a dismissed pull
 * request once it has moved, and the redraft must outlive the old resolution
 * or the sweep deletes its own fresh work. A draft whose review.json is
 * unreadable or carries no parsable timestamp cannot claim to be newer, so
 * the resolution's word stands.
 *
 * @param {string} dir the draft's directory
 * @param {number} time a resolution's time, milliseconds since the epoch
 * @returns {boolean} true when review.json's draftedAt or finishedAt is later
 */
export function draftedAfter(dir, time) {
  let review;

  try {
    review = JSON.parse(fs.readFileSync(path.join(dir, "review.json"), "utf8"));
  } catch {
    return false;
  }

  return [review.draftedAt, review.finishedAt]
    .map((stamp) => Date.parse(stamp || ""))
    .some((ms) => Number.isFinite(ms) && ms > time);
}

/**
 * Delete every draft (and its media — qa.mp4, frames/, whatever sits beside
 * review.json) whose pull request is finished, sparing drafts written after
 * their pull's resolution — those are redrafts of a pull that came back.
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

  for (const [key, resolution] of resolutions(readEvents(draftsDir))) {
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
    if (draftedAfter(dir, resolution.time)) continue;

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
```

### `~/.claude/skills/dev-review-sweep/collector/search-args.js`

```javascript
// Bot pull requests are dependency bumps. A review draft for one says nothing
// worth reading, and a catch-all CODEOWNERS puts every one of them in front of
// a team review request, crowding real pull requests out of the result limit.
const EXCLUDED_AUTHORS = ["app/dependabot"];

/**
 * Argv for one `gh search prs` call. Exclusions go after `--`, or gh reads a
 * leading `-` as one of its own flags. `author`, `isDraft` and `labels` are the
 * facts the reader's rules are checked against.
 *
 * @param {string} qualifier e.g. "--review-requested=@me"
 * @returns {string[]} arguments to pass to `gh`
 */
export function searchArgs(qualifier) {
  return [
    "search", "prs",
    qualifier,
    "--state=open",
    "--limit", "40",
    "--json", "number,title,repository,url,updatedAt,author,isDraft,labels",
    "--",
    ...EXCLUDED_AUTHORS.map((author) => `-author:${author}`),
  ];
}
```

### `~/.claude/skills/dev-review-sweep/collector/rules.js`

```javascript
// What the sweep does with a pull request, as its reader configured it.
//
//   <drafts-dir>/rules.json
//   { "rules": [ { "when": { "author": "priya" }, "then": "post" } ] }
//
// The first rule whose every condition holds decides. A pull request no rule
// names is drafted for a person to read, which is what the sweep always did.
// A file that is only half understood is refused whole: a typo in a condition
// must never widen what gets posted.

import fs from "node:fs";
import path from "node:path";

// What a rule can ask for: post the finished draft, never draft it, or leave
// it as a draft for the reader.
export const ACTIONS = ["post", "skip", "draft"];

// Conditions whose value is text (one value, or a list meaning any of them).
const TEXT = ["author", "repo", "verdict", "label"];

// Conditions whose value is true or false.
const FLAGS = ["isDraft"];

/**
 * A condition's value as a lowercased list.
 *
 * @param {string} name the condition, for the error
 * @param {string|string[]} value one value or several
 * @returns {string[]} the values to match any of
 * @throws {Error} if a value is not text
 */
function wanted(name, value) {
  const values = Array.isArray(value) ? value : [value];

  if (!values.length || values.some((one) => typeof one !== "string" || !one)) {
    throw new Error(`rules.json: ${name} must be text, or a list of text`);
  }

  return values.map((one) => one.toLowerCase());
}

/**
 * One rule, checked.
 *
 * @param {object} rule a rule as written in the file
 * @returns {{when: object, then: string}} the rule with its text conditions normalised
 * @throws {Error} if any part of it is not understood
 */
function parseRule(rule) {
  if (!rule || typeof rule !== "object" || !rule.when || typeof rule.when !== "object") {
    throw new Error("rules.json: every rule needs a when and a then");
  }

  if (!ACTIONS.includes(rule.then)) {
    throw new Error(`rules.json: ${rule.then} is not something a rule can do`);
  }

  const names = Object.keys(rule.when);

  if (!names.length) {
    throw new Error("rules.json: a rule needs at least one condition");
  }

  const when = {};

  for (const name of names) {
    if (TEXT.includes(name)) {
      when[name] = wanted(name, rule.when[name]);
    } else if (FLAGS.includes(name)) {
      if (typeof rule.when[name] !== "boolean") {
        throw new Error(`rules.json: ${name} must be true or false`);
      }

      when[name] = rule.when[name];
    } else {
      throw new Error(`rules.json: ${name} is not a condition`);
    }
  }

  return { when, then: rule.then };
}

/**
 * The rules in a rules file.
 *
 * @param {string} json the file's contents
 * @returns {object[]} the rules, in the order they are tried
 * @throws {Error} if the file is not understood in full
 */
export function parseRules(json) {
  let document;

  try {
    document = JSON.parse(json);
  } catch (error) {
    throw new Error(`rules.json: ${error.message}`);
  }

  if (!document || !Array.isArray(document.rules)) {
    throw new Error("rules.json: expected { \"rules\": [ ... ] }");
  }

  return document.rules.map(parseRule);
}

/**
 * The rules a drafts directory carries. No file means no rules.
 *
 * @param {string} draftsDir the drafts directory
 * @returns {object[]} the rules, in the order they are tried
 * @throws {Error} if the file is there and not understood in full
 */
export function readRules(draftsDir) {
  const file = path.join(draftsDir, "rules.json");

  return fs.existsSync(file) ? parseRules(fs.readFileSync(file, "utf8")) : [];
}

/**
 * Whether one condition holds. A fact nobody knows never satisfies it.
 *
 * @param {string} name the condition
 * @param {string[]|boolean} value what the rule asks for
 * @param {object} facts what is known about the pull request
 * @returns {boolean} whether it holds
 */
function holds(name, value, facts) {
  if (FLAGS.includes(name)) return facts[name] === value;

  const known = name === "label" ? facts.labels : facts[name];
  const have = (Array.isArray(known) ? known : [known])
    .filter((one) => typeof one === "string")
    .map((one) => one.toLowerCase());

  return have.some((one) => value.includes(one));
}

/**
 * What to do with a pull request.
 *
 * @param {object[]} rules rules from parseRules
 * @param {{author?: string, repo?: string, verdict?: string, labels?: string[], isDraft?: boolean}} facts what is known about it
 * @returns {string} "post", "skip" or "draft"
 */
export function actionFor(rules, facts) {
  const rule = rules.find(({ when }) =>
    Object.entries(when).every(([name, value]) => holds(name, value, facts)),
  );

  return rule ? rule.then : "draft";
}
```

### `~/.claude/skills/dev-review-sweep/collector/post.js`

```javascript
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
```

### `~/.claude/skills/dev-review-sweep/collector/review.js`

```javascript
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
```

## After installing

Name a drafts directory in your `CLAUDE.md`, and point a source in the app at the same directory. The sweep writes there and the app reads there; that is the whole integration.

Run `/dev-review-sweep` to draft what is waiting on you, then open the app to read it. What reaches GitHub is what you send.
