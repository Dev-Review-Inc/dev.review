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
