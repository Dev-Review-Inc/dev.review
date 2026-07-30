# The draft schema

A draft is one JSON file in a draft source: the storage the app reads drafts from. Writing that file is the only way anything gets into the app: there is no API, no upload, and no notification. An agent writes a file, the app notices it, and shows it.

The path is derived, not discovered. Each pull request owns one directory, its draft at `review.json` inside:

```text
<owner>--<repo>-<number>/review.json
```

so `org/app#42` is `org--app-42/review.json`. Media the draft refers to — QA recordings, frames — lives in that same directory, beside the draft. The app never lists the directory looking for work. It asks GitHub which pull requests await review, derives the filename for each, and requests it; a missing file means no draft has been written yet. This keeps the queue accurate for free, because a draft left behind after its review request is gone is simply never asked for.

## Shape

```json
{
  "schema": 3,
  "owner": "org",
  "repo": "app",
  "number": 42,
  "title": "Re-root the errors onto a common base class",
  "url": "https://github.com/org/app/pull/42",
  "reviewedAt": "e612b1b",
  "draftedAt": "2026-07-29T15:36:52Z",
  "finishedAt": "2026-07-29T15:41:10Z",
  "verdict": "COMMENT",
  "summary": "Re-rooted correctly, but the family catch-all is now inert and one spec cannot fail.",
  "sections": [
    { "key": "correctness", "label": "Correctness", "color": "warn" },
    { "key": "tests-conventions", "label": "Tests & conventions", "color": "critical" }
  ],
  "findings": [
    {
      "id": "inert-catch-all",
      "section": "correctness",
      "path": "lib/app/records/error.rb",
      "line": 12,
      "kind": "inert-rescue",
      "color": "critical",
      "blocking": true,
      "body": "The rescue clause now parses and never matches …",
      "suggestion": "module Error; end\n"
    }
  ],
  "qa": {
    "note": "Removed a member through the UI and re-added them; the other members stayed in place.",
    "scenarios": [
      {
        "id": "remove-member",
        "url": "/account/members",
        "what": "removing a member leaves the others in place",
        "verdict": "pass",
        "video": "org--app-42/run.mp4",
        "frames": 6,
        "durationMs": 4200
      }
    ]
  },
  "comment": "**Comment** — a family catch-all that is now silently inert. …"
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Must be `3`. A draft written to a later schema is refused rather than half-understood. |
| `owner`, `repo`, `number` | yes | Identify the pull request. They must agree with the filename. |
| `title`, `url` | no | Shown in the header. |
| `reviewedAt` | no | The commit the review was written against. Shown so a stale draft is visible as stale, and sent as the review's `commit_id`. |
| `draftedAt` | no | ISO 8601 timestamp of the most recent write — including an in-progress one. |
| `finishedAt` | no | ISO 8601 timestamp set only on the write that finishes the review. Absent while still in progress, however much of `sections` and `findings` has landed so far. |
| `progress` | no | Where an unfinished review has got to: `{ "note": "QA: scenario 2 of 3", "percent": 60 }`. Both parts optional. Refresh it on each incremental write; it is ignored once `finishedAt` is set. |
| `verdict` | yes | `APPROVE`, `COMMENT` or `REQUEST_CHANGES` — a GitHub review event, used verbatim. |
| `summary` | no | One line, plain text. What the reviewer would say in a sentence. Not posted. |
| `sections` | no | How the review is organised. Shown in the verdict pane and used as its filters. Not posted. |
| `findings` | no | The individual comments, each anchored to a file and line. Posted as inline review comments, minus any the reader drops. |
| `qa` | no | Evidence from actually running the change. Not posted. |
| `comment` | no | Markdown, posted as the review's body. Empty is legitimate: the findings can be the whole review. |

## Sections

Sections are whatever the agent decides they are. The app does not know what a review is made of and does not need to: it renders the sections it is given, in the order given, and offers each as a filter over the findings. An agent reviewing a schema migration can emit `data-loss`, `rollback` and `locking`; one reviewing copy can emit `tone` and `grammar`. Nothing is declared in advance.

| Field | Required | Meaning |
|---|---|---|
| `key` | yes | Stable identifier, lowercase with hyphens. Unique within a draft, since it identifies a filter. |
| `label` | no | What the reader sees. Defaults to the key with hyphens replaced and the first letter capitalised, so `data-loss` reads as "Data loss". |
| `color` | no | One of `neutral`, `ok`, `warn`, `critical`, `accent`. Defaults to `neutral`. |
| `count` | no | Overrides the badge. Normally omitted: the app counts the findings pointing at this section. |
| `body` | no | Markdown shown when the section is opened, for reading that belongs to no single line. |

**`color` is a named token, not a value.** The app maps each name onto its own palette, so a draft reads correctly in both light and dark and no agent can produce an unreadable pane by inventing a hex value. An unrecognised name falls back to `neutral` rather than failing the draft — a mis-picked colour should not cost you a review.

The glyph beside each section derives from its colour rather than being chosen, so an agent cannot pair a green tick with a critical finding.

## Findings

A finding is one comment on one line. This is what the app stages, what the reader keeps or drops, and what gets posted as an inline review comment.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable within the draft. The app remembers what you kept and dropped by id, so redrafting the same review does not lose your decisions. |
| `path` | yes | Repository-relative path, as GitHub names it in the diff. |
| `line` | yes | Line in the file's new state. A finding about deleted code points at the line that replaced it. |
| `section` | no | The key of the section this belongs to. Drives the lens filter and the section counts. A finding pointing at no section still shows, unfiltered. |
| `kind` | no | A short kebab-case badge naming the specific concern, coined by the agent: `contract-drift`, `impossible-remedy`, `untested-boundary`. Free text; the app renders it and does not interpret it. Name the concern rather than the genre — `bug` and `suggestion` say nothing `color` and `blocking` do not already, and a well-coined kind lets the reader triage from the badge alone. Findings sharing one are grouped as a theme. |
| `color` | no | Same named set as sections, colouring the badge. Defaults to `neutral`. |
| `blocking` | no | Whether this finding should hold up merge on its own. Defaults to `false`. Counted in the footer, and warned about there if the reader approves anyway. |
| `body` | yes | Markdown. The comment as it would be posted. |
| `suggestion` | no | Replacement text for the line, posted as a committable GitHub suggestion. The app shows it as a patch; GitHub renders an Apply button. |

Ordering is the agent's: findings are shown, and posted, in the order written, so the most important one goes first. `blocking` is the only severity signal a finding carries, and it is not posted — it only shapes what the footer says before the reader sends the review.

Three fields on a finding, and two at the top level, belong to the reader rather
than the agent. **An agent writing a draft leaves all of them out, and the app
no longer writes them either.** The reader's decisions are kept in the event
log described under [Where drafts live](#where-drafts-live). They are still read,
so a draft written by an older version of this app is understood rather than
refused.

| Field | Meaning |
|---|---|
| `dropped` | The reader dropped this finding, so it will not be posted. It is marked rather than deleted, so it can be restored and what the agent said stays readable. |
| `drafted` | What the agent originally wrote, from before the reader edited the body. |
| `posted` | ISO 8601 timestamp of the reader posting this one finding on its own, ahead of the review. A posted finding is excluded from the review when that goes up. |

Likewise the top-level `postedAt` and `postedUrl` record the reader posting the
whole review.

## QA

Evidence from running the change. None of it is posted — it is here so the reader can see what was actually exercised before deciding to trust the review.

| Field | Required | Meaning |
|---|---|---|
| `note` | no | One paragraph: what was actually driven. For a change with nothing observable to drive, say that and what was read instead — never that QA was skipped because nobody was watching. A draft with no scenarios and no note reads as though nobody thought about it. |
| `scenarios` | no | One entry per scenario run. |

Each scenario:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable within the draft. |
| `url` | no | The route it drove. |
| `what` | no | One line: what it proves. |
| `verdict` | no | `pass`, `fail` or `skip`. Defaults to `skip`. A failing scenario is evidence, not an error — it is the most valuable thing a review carries and the app shows it first. |
| `video` | no | Path to the recording, relative to the drafts directory. |
| `frames` | no | How many frames were captured. |
| `durationMs` | no | How long the run took. |

`video` is **relative to the drafts directory and must stay inside it**. An absolute path, or one climbing out with `..`, is refused: the app reads video from that directory and nowhere else, so a draft cannot make it open an arbitrary file.

Videos are just files an agent writes next to its draft. An agent that wants them presented on their own can emit a section for them and point its findings there; the app needs no special mode for that.

## Where drafts live

A draft source is a name and a piece of storage the customer already owns: a
folder on their computer, or a bucket. Drafts sit under `drafts/` at the root of
it, one directory per pull request:

```text
<draft source>/drafts/<owner>--<repo>-<number>/review.json
```

Switching source changes the queue and its drafts together, so two sources
watching different orgs cannot collide.

One other thing lives in that storage, and it is the app's rather than the
agent's:

```text
<draft source>/.reviewer/events/<device>.jsonl
```

That is the reader's own log: what they dropped, edited, posted and dismissed,
one append-only file per device. It is deliberately separate from the draft.
**The app never writes to a draft.** An agent is the only author of the file it
wrote, so the two can never race for the same bytes, and an agent is free to
rewrite its draft while the reader is part way through reading it.

This is why `dropped`, `drafted`, `posted`, `postedAt` and `postedUrl` are read
from a draft but never written to one. A draft that carries them, because an
older version of this app wrote them, is still read correctly.

## Changing this schema

`schema` exists so that a change is loud. Adding an optional field needs no version bump. Removing a field, renaming one, or changing the meaning of an existing one is a bump, and the app refuses anything it does not recognise — which it says plainly rather than showing a blank pane.

### 3 — findings and QA become data

Version 2 carried the whole review as one markdown blob, so the app could show it and nothing else. Every per-line affordance the interface wants — anchoring a comment to a file, filtering by section, staging and dropping individual comments, offering a committable suggestion, counting what is staged — needs the review broken into pieces, and a blob cannot be broken up after the fact without guessing.

`findings` and `qa` make those pieces explicit. `comment` remains, now meaning only the review's body: the framing above the inline comments rather than the whole review.

### 2 — sections replace lenses

Version 1 had `lenses`, a list of `{ name, body }`, which encoded one review skill's four fixed lenses into the format every reviewer had to speak. An agent reviewing a schema migration has nothing useful to say under "Marketing", and no way to say anything under "Data loss". Sections are declared by whoever writes the draft; the app renders what it is handed. `summary` was added in the same bump.
