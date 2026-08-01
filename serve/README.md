# serve

A static file server for the reviewer interface. It has no application logic:
storage runs through adapters in the browser, and GitHub is called from the
browser with the reader's own token, so this process holds no credential and
has no route that reads or writes anything.

Its own Go module, and no dependencies.

## Build

From the repository root:

    cp -R web serve/web
    cd serve && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o reviewer-serve .

Or as an image, again from the repository root so `web/` is in the context:

    docker build -f serve/Dockerfile -t reviewer .
    docker run -p 8080:80 reviewer

The image listens on 80, because that is what the hosting it is built for
forwards to. It comes from `CMD ["-addr", ":80"]` rather than from the flag's
default, so the port is a fact about the image and not about the program, and
`docker run reviewer -addr :9000` still overrides it.

## Run

    ./reviewer-serve                          # embedded interface on :8080
    ./reviewer-serve -dir ../web              # serve a directory from disk instead
    ./reviewer-serve -dir ../web -dev         # the working tree, reloading on edit
    ./reviewer-serve -addr 127.0.0.1:8080     # bind somewhere else

| Flag | Default | What it does |
| --- | --- | --- |
| `-addr` | `:8080` | Address to listen on. All interfaces, because the normal home for this is a container behind a proxy. |
| `-dir` | empty | Serve a directory from disk instead of the embedded copy. Prepared once at startup and cached, the same as the embedded copy, because a directory is not by itself a development signal: the marketing site is production and serves its pages this way. |
| `-dev` | off | Re-read `-dir` on every request, never cache, and reload the page on edit. Development only, and ignored without `-dir`. |
| `-csp` | empty | Replace the content security policy entirely. For hosting that needs a different shape, at the cost of owning what it allows. |

## The embed decision

`go:embed` cannot reach outside its own module directory, so the module cannot
embed the repository's `web/` where it sits. The build copies `web/` into
`serve/web/` first, and the Dockerfile does that copy as one of its own layers.

`serve/web/index.html` is committed as a placeholder that says the interface was
not copied in. It exists because `go:embed` refuses to compile against a
directory that is not there, and a fresh checkout has to build and test without
running a copy step first. Any real build overwrites it; the Docker build never
copies it into the image at all.

`-dir -dev` covers development, where waiting on a copy and a rebuild to see an
edit is not worth it. Embedded is the default because embedded is what ships.

## The policy

One documented constant in `serve.go`, sent on every response - assets, the
single-page fallback, 404s, and 304s alike. No route is exempt.

    default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none';
    form-action 'none'; frame-ancestors 'self'; connect-src 'self' https:;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:;
    media-src 'self' blob:

`script-src 'self'` is the one that matters. The GitHub token lives in local
storage on this origin, so any script running here can read it, and script may
therefore come from this origin and nowhere else. `object-src`, `base-uri` and
`form-action` close the remaining ways to get code or a destination in.

`frame-ancestors 'self'` is set explicitly, because `default-src` is not a
fallback for it. Without it the interface can be framed and clickjacked from
anywhere.

It is `'self'` rather than `'none'` because the marketing site pins the real
interface into the page as a same-origin frame, so the demo is the product
rather than a screenshot of it. Nobody but us can serve a page on this origin,
so letting this origin frame itself closes nothing: the clickjacking the
directive exists to stop is a cross-origin frame, and that stays refused.

`connect-src 'self' https:` is the deliberate compromise. The storage adapter
talks to the customer's own S3-compatible endpoint, configured at runtime and
unknown when the binary is built. A build-time allowlist would mean only
endpoints we had heard of would work, which breaks the promise that the storage
is theirs. This does widen where data could be sent to any https origin, and
that is worth saying plainly - but with `script-src 'self'` there is no attacker
script on the page to do the sending, so the exposure is bounded by our own
code. Plain http is still refused.

`img-src 'self' data: blob:` and `media-src 'self' blob:` are there because QA
evidence comes back from the adapter as bytes and is shown through blob URLs
rather than fetched over the network.

`font-src` includes `'self'` so a font shipped in the binary can load.

## Behaviour worth knowing

- Content types are set from a table in the source, not from the host's MIME
  database. A box that calls `.js` something other than `text/javascript` would
  otherwise stop every ES module from loading.
- Compressible files over 1 KB are gzipped once at startup and served from
  memory. Already-compressed types are never gzipped. `Vary: Accept-Encoding` is
  always set, and the gzip representation carries its own strong ETag.
- Unknown paths without a file extension serve `index.html`, so client-side
  routing works. A missing path *with* an extension is a 404: answering a
  missing module with HTML produces a syntax error instead of a useful one.
- `/up` is the health endpoint the hosting probes, and is a route of its own so
  that the fallback above can never answer it. A 200 there means `index.html` is
  present and so is every local file it names: the entry module, the manifest,
  the icons. That set is read out of the document rather than written down in
  the source, so it cannot go stale. Anything absent is a 503 naming it.
- A tree the interface cannot run from is refused at startup, with the absent
  files in the log, rather than served. A deploy that arrives in pieces fails as
  a deploy instead of as a 404 on the reader's first module.
- Directories are never listed. Only files in the set are addressable.
- `index.html` is `no-cache`. Hashed asset names are immutable for a year.
  Everything else gets five minutes. Under `-dev` every response is `no-store`
  instead, because an edit answered from the browser's own cache is an edit
  nobody can see.
- Under `-dev`, and only there, the page reloads itself when a file in the
  served directory changes. `index.html` gains one `<script src="/reload.js">`
  on the way out, that script opens an event stream at `/reload`, and the
  server restamps the directory four times a second and speaks when the stamp
  moves. Both halves are same-origin, so `script-src 'self'` and
  `connect-src 'self'` cover it and the policy is untouched. A snapshot cannot
  change under a running process, so it carries none of this.

## Test

    cd serve && go test ./... && go vet ./...

The tests build their own in-memory filesystem, so a change to the real
interface cannot turn them red.

## Deploying

Anything that runs a container runs this. Push to `main` and
[GitHub Actions](../.github/workflows/docker.yml) runs both suites, then builds
the image from the repository root with `-f serve/Dockerfile` and pushes it to
`ghcr.io/<owner>/dev-review`. Every commit is tagged with its full sha as well
as `latest`, so an install can be pinned to one and a rollback has a name to go
back to.

What we run it on is [Basecamp ONCE](https://once.com), which installs the image
on the machine and runs it behind kamal-proxy. The proxy holds 80 and 443,
routes by hostname and terminates TLS on a Let's Encrypt certificate.

### The contract

ONCE runs any container that meets four conditions. Three of them it checks at
install time, giving up after two minutes, so each is worth knowing. They are
also a fair description of what any host needs from this image.

| ONCE asks for | How this image answers |
| --- | --- |
| A Docker container | `Dockerfile`: distroless, static, one binary, running as uid 65532 |
| HTTP on port 80 | `CMD ["-addr", ":80"]`. kamal-proxy is given a target with no port in it, which means 80, and it never asks. Nothing has to be given up to bind it: Docker sets `net.ipv4.ip_unprivileged_port_start=0`, so the unprivileged user binds 80 without a capability |
| A healthcheck at `/up` returning success | A 200 there says `index.html` and every local file it names are present and servable, which is the only thing this process does. `TestUpIsTheHealthEndpoint` holds it |
| Persistent data in `/storage` | There is none, so no volume is needed. The reader's token lives in their browser and their drafts live in their own storage; this process reads nothing off disk and writes nothing to it |

### Before the first install

1. Point the hostname's DNS at the machine with an `A` record, **and let it
   resolve first**. The certificate is issued during the install by validating
   the name, so an install that runs ahead of DNS gets no cert.
2. If the image you are installing is private, `docker login ghcr.io` on the
   machine first, with a GitHub PAT scoped `read:packages`. ONCE authenticates a
   pull from whatever the machine's Docker config holds (`registryAuthFor` in
   its `internal/docker/application.go`) and otherwise pulls anonymously, which
   against a private image is not a slower pull but no pull at all. That PAT is
   the only secret in the deployment. The app holds no credential of its own.

### Installing

`once` asks rather than taking flags. Give it the image path and the hostname
when it prompts for them. Shipping a change after that is pushing to `main`: the
workflow moves `latest`, and ONCE updates itself from it.
