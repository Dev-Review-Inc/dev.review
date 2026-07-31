# reviewer

A browser front end for the review drafts an agent leaves in your storage. It
shows what is waiting on your review, what the agent drafted for each one, and
posts the review under your own name when you say so.

See [POSITIONING.md](POSITIONING.md) for what this is for, who it is for, and
what is deliberately out of scope.

## What it is

A static site. Nothing on the server holds anything: no database, no credential,
no copy of your files. The page runs in your browser, reads drafts from storage
you already own, and talks to GitHub with your own token.

Everything you decide while reading is kept as an append-only event log in that
same storage, so a second device can pick up where you left off.

## Sources and destinations

Drafts come from a source. Reviews go to a destination. The two are configured
apart, because they are independent choices.

A **source** is a name and the storage its drafts live in.

| Source | What it is | Where it works |
| --- | --- | --- |
| A folder on this computer | The File System Access API, with the folder handle remembered between sessions | Chromium browsers |
| This computer | The desktop build's own filesystem access | Inside the Tauri app |
| S3 bucket | Any S3-compatible endpoint: AWS, R2, MinIO | Anywhere, given bucket CORS |
| A GitHub repository | The contents API, with a fine-grained token scoped to that repository | Anywhere: `api.github.com` answers a browser directly |
| A git repository | Any host you push to. A write is a commit, so the history is the audit trail | The desktop app drives the git on your machine; a browser needs a CORS proxy |
| In memory | Keeps nothing, for trying the interface out | Anywhere |

Every one of them points at storage the customer already owns. There is no
source that points at us, and there is no tier where this app holds anyone's
files.

A **destination** is where a review is posted. Today that is GitHub, with a
personal access token. Adding GitLab is adding a file in
`web/src/destinations/`.

## The token

Fine-grained is preferable, scoped to the repositories you review: **Pull
requests** read and write, **Metadata** read. That is the entire surface the app
needs.

Some organisations require an owner to approve fine-grained tokens on their
repositories. If yours does, a classic token with the single `repo` scope works,
but understand that `repo` grants read and write to every repository you can
reach. There is no narrower classic scope that can post a review.

Set an expiry either way.

The token never leaves your browser. `api.github.com` permits cross-origin
requests with an `Authorization` header, so nothing proxies and no credential
exists anywhere but the machine you are sitting at.

## How drafts get in

An agent writes a JSON file. That is the whole integration: no API, no upload,
no notification.

Paths are derived, never listed. Each pull request owns a directory,
`drafts/<owner>--<repo>-<number>/`, with its draft at `review.json` and any
media beside it. The client asks GitHub which pull requests await your review,
derives the path for each, and requests it. A missing file means nothing has
been drafted yet.

See [docs/draft-schema.md](docs/draft-schema.md) for the shape, which is
authoritative and versioned.

**The app never writes to a draft.** The agent is the only author of the file it
wrote, so the two cannot race for the same bytes, and an agent is free to
rewrite its draft while you are part way through reading it. What you decide,
including dropped, edited, posted, dismissed and read, is kept in the app's own
log at `.reviewer/events/<device>.jsonl`: one append-only file per device, so no
two browsers write the same file either.

## Running it

```sh
cd serve
go run . -dir ../web -dev
```

For a deployable binary, copy the interface in and build:

```sh
cp -R web serve/web
cd serve && go build -o reviewer-serve .
```

The server serves files and does nothing else. See
[serve/README.md](serve/README.md) for the flags, the Dockerfile, and the
content security policy.

The desktop build is in [src-tauri/](src-tauri/README.md).

## Deploying

Push to `main` and [GitHub Actions](.github/workflows/docker.yml) runs both
suites, then builds the image from the repository root with
`-f serve/Dockerfile` and pushes it to `ghcr.io/<owner>/dev-review`.
[Basecamp ONCE](https://once.com) installs that image on the machine and runs it
behind kamal-proxy, which holds 80 and 443 there, routes by hostname and
terminates TLS on a Let's Encrypt certificate.

### The contract

ONCE runs any container that meets four conditions. Three of them it checks at
install time, giving up after two minutes, so each is worth knowing:

| ONCE asks for | How this image answers |
| --- | --- |
| A Docker container | `serve/Dockerfile`: distroless, static, one binary, running as uid 65532 |
| HTTP on port 80 | `CMD ["-addr", ":80"]`. kamal-proxy is given a target with no port in it, which means 80, and it never asks. Nothing has to be given up to bind it: Docker sets `net.ipv4.ip_unprivileged_port_start=0`, so the unprivileged user binds 80 without a capability |
| A healthcheck at `/up` returning success | `/up` names no file and carries no extension, so it is answered with the interface itself. A 200 there says the embedded interface is present and servable, which is the only thing this process does. `TestUpIsTheHealthEndpoint` holds it |
| Persistent data in `/storage` | There is none, so no volume is needed. The reader's token lives in their browser and their drafts live in their own storage; this process reads nothing off disk and writes nothing to it |

### Before the first install

1. Point the hostname's DNS at the machine with an `A` record, **and let it
   resolve first**. The certificate is issued during the install by validating
   the name, so an install that runs ahead of DNS gets no cert.
2. `docker login ghcr.io` on the machine, with a GitHub PAT scoped
   `read:packages`. The repository is private, so its image is private. ONCE
   authenticates a pull from whatever the machine's Docker config holds
   (`registryAuthFor` in its `internal/docker/application.go`) and otherwise
   pulls anonymously, which against a private image is not a slower pull but no
   pull at all. That PAT is the only secret in the deployment. The app holds no
   credential of its own.

### Installing

`once` asks rather than taking flags. Give it the image path,
`ghcr.io/<owner>/dev-review`, and the hostname when it prompts for them.

Shipping a change after that is pushing to `main`: the workflow moves `latest`,
and ONCE updates itself from it. Every commit is also tagged with its full sha,
so an install can be pinned to one and a rollback has a name to go back to.

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

Two suites are load-bearing.

`test/render.test.js` covers the escaping. Drafts quote pull request titles and
diff hunks written by other people, and the GitHub token sits in storage on the
same origin, so markdown is rendered by an escape-everything-then-restore-an-allowlist
pass rather than by a markdown library. The page carries a CSP that keeps script
to its own origin.

`test/adapters/conformance.js` is one suite that every source backend is run
through: GitHub against a fake of the API, and git once for each of its two
transports, the browser one and the native one. A backend either behaves like
the others or fails out loud, which is what keeps adding the next one to an
afternoon.

## Contributing

Issues and pull requests are welcome. `main` is protected, so everything lands
through a pull request, and every commit carries a `Signed-off-by` line. See
[CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) for anything
that should not be a public issue.

## Licence

[Apache-2.0](LICENSE). Use it, fork it, ship it, sell it. The patent grant is
included, and there is no clause reserving anything back.

What is sold is the client that syncs and coordinates a team over storage you
already own. Nothing about that depends on the source being closed, which is
why it is not.
