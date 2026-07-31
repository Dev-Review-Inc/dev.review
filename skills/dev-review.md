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
- **One scenario entry per QA run — one scenario file, one recording.** A run that checks five things is still one entry; listing its checkpoints as separate scenarios makes the app play the same video once per entry. No two entries share a `video`. Several entries mean several runs, each recording copied in under its own name: the runner always writes `qa.mp4`, so a second run left at that name overwrites the first.
- A scenario with no `verdict` counts as `skip`. Silence is not a pass.
- `comment` is the body of the review, not the whole review. Keep the findings out of it. If something is related to a diff, use `findings`. Otherwise, use the main `comment`.
