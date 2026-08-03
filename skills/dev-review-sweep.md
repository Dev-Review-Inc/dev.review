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

## After every fresh PR is drafted: prune finished ones

A draft's reviewer app already knows when its review was posted or dismissed — that is what the sync log is for. Once the fresh PRs above are drafted, clear out the drafts that are done with:

```bash
node ~/.claude/skills/dev-review-sweep/collector/prune-drafts.js run <drafts-dir>   # delete drafts posted or dismissed, print which ones
```

This deletes matching draft folders (and their QA media) from disk only. Commit and push the deletion the same way a draft write is: run the "Sync to git" step from **/dev-review** against `<drafts-dir>` — `git add -A`, commit, push — rather than a second git flow.

## Finish with

One short paragraph: what you drafted, how many were deferred and which, how many drafts were pruned as posted or dismissed, and anything that failed and why — including any git sync failure /dev-review or the prune step reported. Never let the cap pass silently.
