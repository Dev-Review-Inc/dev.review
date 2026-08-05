# Reviewer

**An agent drafts the code review. You decide what goes out.**

An agent reads the pull requests waiting on you and writes a draft review for
each one into storage you already own. Reviewer is where you read that draft:
the findings anchored to the diff, the summary, the recorded browser runs that
prove the change was driven rather than only read. You cut what is wrong, write
what is missing, and post it under your own name.

The agent does the first pass. You are still the reviewer, and nothing reaches
GitHub until you press post.

It runs as a signed macOS app and as a web app you can serve yourself.

## Try it without setting anything up

Run the interface and add `?demo=1`:

```sh
cd serve
go run . -dir ../web -dev
```

Then open <http://localhost:8080/?demo=1>.

That attaches two sample sources, a tour and a real review of a real commit in
this repository, plus a destination that posts nowhere and says so
([`web/src/app/demo.js`](web/src/app/demo.js)). No agent, no token, no folder.
Include a finding and reload: it stays included, because the event log underneath
is the real one. The site at [dev.review](https://dev.review) runs the same thing
in a frame.

## Why it is built this way

Three decisions shape everything else, and each one is checkable in the tree
rather than a promise.

**Your storage, not ours.** Drafts live in a folder on your machine, an
S3-compatible bucket, a GitHub repository, or a git repository you push to.
There is no storage backend that points at us, and there is no tier where this
project holds your files. The list of backends is
[`web/src/adapters/index.js`](web/src/adapters/index.js); each is one file
beside it.

**Your token, not ours.** The GitHub token is stored in your browser and used to
call `api.github.com` directly, which permits cross-origin requests carrying an
`Authorization` header. Nothing proxies it, so no credential exists anywhere but
the machine you are sitting at
([`web/src/destinations/github.js`](web/src/destinations/github.js)). Secrets
are kept out of the synced log on purpose: a credential that syncs is a
credential that leaves the browser it was typed into
([`web/src/state/multi-event-store.js`](web/src/state/multi-event-store.js)).

**No server in the middle.** The web build is a static site. The Go server in
[`serve/`](serve/README.md) hands out files and has no route that reads or
writes anything, no database and no credential. If you would rather not run even
that, the desktop app is the same interface with no server at all.

What you decide while reading is an append-only event log in that same storage,
one file per device under `.reviewer/events/`
([`web/src/state/sync.js`](web/src/state/sync.js)). Events are immutable and
carry the time they happened, so absorbing one twice is a no-op and absorbing
them out of order lands on the same state. Read a review on the laptop, finish
it on the desktop, and the inclusions and edits are already there.

### Zero JavaScript dependencies

[`package.json`](package.json) has no `dependencies` and no `devDependencies`.
There is no lockfile, no `node_modules`, and no bundler. The Go server's
[`go.mod`](serve/go.mod) is three lines with an empty require block. Tests run
on `node --test` and headless Chrome.

Being exact about it: [`web/vendor/`](web/vendor/README.md) holds three MIT
libraries copied in byte for byte with their licences, loaded only by the git
backend; the Rust desktop shell uses Cargo crates; and the lint hooks fetch
pinned tools on demand. Nothing is installed to run the app or to serve it.

The point is not minimalism. Your GitHub token sits in local storage on the same
origin as this code, so every package that ships here is a package that can read
it. [`CONTRIBUTING.md`](CONTRIBUTING.md) requires an argument in an issue before
a dependency is added, and that rule covers GitHub Actions too.

## What a review looks like

![The interface in dark theme, reviewing a pull request that paginates an orders
endpoint. The left rail lists every pass the agent made with its finding count,
including Query cost, ticked with nothing flagged. In the diff the deleted
where clause is struck through in red, and a finding card hangs under
src/api/orders.js:42 explaining that the limit is unbounded, carrying a
suggested change marked committable and Edit, Post this comment and Drop
buttons. The footer reads five comments staged, two blocking and three notes,
with Request changes
selected.](docs/media/review-diff-finding.png)

**A change arrives because it is waiting on you.** The app asks GitHub which
pull requests await your review and which are your own, and shows them in one
queue with the drafted ones first
([`web/src/queries/index.js`](web/src/queries/index.js)). The first finished
review opens by itself.

**Sections, including the clean ones.** The agent declares what it looked at,
and each pass gets a row in the rail with its finding count. A pass with nothing
flagged still shows and says so, because "checked and clean" and "not looked at"
are different answers ([`web/src/app/rail.js`](web/src/app/rail.js),
[`web/src/app/diff-pane.js`](web/src/app/diff-pane.js)). Click a row to filter
the review to it, click again to clear.

**Findings sit under the line they name.** The diff is parsed from the patch and
drawn per file, collapsible, with adds and deletes and a viewed tick that
persists. Click any new-side line number to write a finding of your own
([`web/src/app/findings.js`](web/src/app/findings.js)).

**Editing is yours.** Edit a finding, include it in the review, take it back out,
or revert it to what the agent drafted. Click the summary to rewrite it. The draft file is never
written to: your decisions are events laid over it, so the agent can rewrite its
draft while you are part way through reading and neither of you loses anything.

**QA evidence, not assertions.** A draft can carry recorded browser runs, one
scenario per run with the route it drove, what it proves, a verdict and the
video. Failing runs sort to the top. A missing verdict reads as "not run", since
nobody saying it passed is not the same as passing
([`web/src/app/qa.js`](web/src/app/qa.js),
[`web/src/domain/draft.js`](web/src/domain/draft.js)). Recordings come through
the storage adapter as blob URLs, never fetched over the network.

![The QA tab of the same review. One run is listed, marked FAILED, for the route
/account/orders under the scenario "the first page holds the order just
placed". Below it a video of the recorded browser session sits paused on the
shop's order confirmation page, captioned eight frames over 6.4 seconds. The
note beneath says the run is the failing one and explains that the access
finding was not driven because it is provable from the diff
alone.](docs/media/qa-evidence-failing-run.png)

**Posting is deliberate.** Approve, comment or request changes, each button
stating its consequence. A confirmation sheet shows the exact body and the exact
line comments before anything leaves, and an empty review is refused
([`web/src/app/confirm.js`](web/src/app/confirm.js),
[`web/src/domain/review.js`](web/src/domain/review.js)). One `POST` to the
reviews API, pinned to the head commit. On your own pull requests only "comment"
is offered.

## How a draft gets in

An agent writes a JSON file. That is the whole integration: no API, no upload,
no notification.

Paths are derived, never listed. Each pull request owns a directory,
`drafts/<owner>--<repo>-<number>/`, with its draft at `review.json` and any
media beside it. The client asks GitHub which pull requests await your review,
derives the path for each, and requests it. A missing file means nothing has
been drafted yet. Deleting a draft is how you ask for another one, because a
sweep reviews whatever has none.

The shape is documented and versioned in
[`docs/draft-schema.md`](docs/draft-schema.md). A draft declaring a schema this
client cannot read is refused rather than half understood. Anything that can
write that file can feed this interface, which is the whole of the neutrality
claim: bring your own agent.

The skills in [`skills/`](skills/) are the drafting agent we use, and
[`install.md`](install.md) installs them — read it yourself, hand it to an
agent, or run `node install.mjs` for a wizard that asks where drafts should
live, whether that's backed by a git remote, and installs the skills once it
has an answer. They are one implementation of the schema, not a requirement of
it.

## Sources and destinations

Drafts come from a source. Reviews go to a destination. The two are configured
apart, because they are independent choices.

| Source | What it is | Where it works |
| --- | --- | --- |
| A folder on this computer | The File System Access API, with the folder handle remembered between sessions | Chromium browsers |
| This computer | The desktop build's own filesystem access | Inside the macOS app |
| S3 bucket | Any S3-compatible endpoint: AWS, R2, MinIO | Anywhere, given bucket CORS |
| A GitHub repository | The contents API, with a fine-grained token scoped to that repository | Anywhere: `api.github.com` answers a browser directly |
| A git repository | Any host you push to. A write is a commit, so the history is the audit trail | The desktop app drives the git on your machine; a browser needs a CORS proxy, and an ssh remote needs the desktop app |

A **destination** is where a review is posted. Today that is GitHub, with a
personal access token. Adding GitLab is adding a file in
[`web/src/destinations/`](web/src/destinations/).

Every source backend is run through one shared suite,
[`test/adapters/conformance.js`](test/adapters/conformance.js). A backend either
behaves like the others or fails out loud, which is what keeps adding the next
one to an afternoon.

## The token

Fine-grained is preferable, scoped to the repositories you review: **Pull
requests** read and write, **Metadata** read. That is the entire surface the app
needs.

Some organisations require an owner to approve fine-grained tokens on their
repositories. If yours does, a classic token with the single `repo` scope works,
but understand that `repo` grants read and write to every repository you can
reach. There is no narrower classic scope that can post a review.

Set an expiry either way. [`SECURITY.md`](SECURITY.md) has the threat model,
including the one case where the token is exposed to somebody else: a git CORS
proxy you do not operate.

## Getting it

**macOS.** Download the `.dmg` from [Releases](../../releases/latest) and drag it
to Applications. It is a universal build, signed with a Developer ID and
notarised, and the ticket is stapled to the disk image as well as the app, so
Gatekeeper is satisfied on first launch even offline
([`.github/workflows/release.yml`](.github/workflows/release.yml)).

There is no Windows or Linux desktop build. Both are served by the web build.

**The web build.** Serve the working tree:

```sh
cd serve
go run . -dir ../web -dev
```

Or build a binary with the interface embedded:

```sh
cp -R web serve/web
cd serve && go build -o reviewer-serve .
```

Or run the container, from the repository root so `web/` is in the context:

```sh
docker build -f serve/Dockerfile -t reviewer .
docker run -p 8080:80 reviewer
```

The image is distroless and static, one binary as uid 65532, listening on 80,
with a health endpoint at `/up` that checks the interface is actually present
rather than that the process is alive. It needs no volume, because there is
nothing to persist. [`serve/README.md`](serve/README.md) has the flags, the
content security policy and the deployment notes.

In a browser, the local-folder source needs a Chromium browser and a secure
context; a bucket or a repository as your source works anywhere. The app says
which of the two is missing rather than reporting that it is unsupported
([`web/src/adapters/filesystem.js`](web/src/adapters/filesystem.js)).

## Development

```sh
npm test                          # the client: units, then end to end
cd serve && go test ./...         # the file server
cd src-tauri && cargo test        # the native source's path containment
```

`npm test` runs `test/` in process and then `e2e/`, which boots `serve/` and
drives headless Chrome. It takes the Chrome already on the machine, so there is
nothing to install, but there does have to be one: set `CHROME_PATH` if yours is
somewhere the harness does not look. A missing browser fails the run rather than
skipping it, which is why CI names the binary before it starts.

The desktop build is in [`src-tauri/`](src-tauri/README.md), which is candid
about what has and has not been verified.

Two suites are load-bearing. `test/render.test.js` covers the escaping: drafts
quote pull request titles and diff hunks written by other people, and the token
sits in storage on the same origin, so markdown is rendered by an
escape-everything-then-restore-an-allowlist pass rather than by a markdown
library. The page carries a content security policy that keeps script to its own
origin. `test/adapters/conformance.js` is the shared backend suite described
above.

## Contributing

Issues and pull requests are welcome. `main` is protected, so everything lands
through a pull request including the maintainer's, and every commit carries a
`Signed-off-by` line: `git commit -s`. One change, with a test. No new
dependencies without an argument in an issue first. Comments explain why, not
what.

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the detail, and
[`SECURITY.md`](SECURITY.md) covers anything that should not be a public issue.

## Where this is

Version 0.5.8. It is young. It is used daily by the people who wrote it, and
every release is gated on the test suite, but there is no community around it
yet and nothing here should be read as a promise about what comes next. GitLab
is not supported. There is no text search and there are no keyboard shortcuts.
The desktop build is macOS only.

## Licence

[Apache-2.0](LICENSE). Use it, fork it, ship it, sell it. The patent grant is
included, and there is no clause reserving anything back.

What is sold is the client that syncs and coordinates a team over storage they
already own. None of that depends on the source being closed, which is why it is
not.
