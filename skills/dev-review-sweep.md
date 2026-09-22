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

An auto-posted review always goes to GitHub as a comment, whatever verdict the draft carries. The `verdict` condition still decides whether a rule posts, and the review's words still say what it found. Approving a pull request, or requesting changes on it, stays a human act in the app.

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
