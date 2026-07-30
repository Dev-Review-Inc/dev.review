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
    ./reviewer-serve -dir ../web              # serve the working tree instead
    ./reviewer-serve -addr 127.0.0.1:8080     # bind somewhere else

| Flag | Default | What it does |
| --- | --- | --- |
| `-addr` | `:8080` | Address to listen on. All interfaces, because the normal home for this is a container behind a proxy. |
| `-dir` | empty | Serve a directory from disk instead of the embedded copy, re-read on every request, never cached, and hot reloaded. Development only. |
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

`-dir` covers development, where waiting on a copy and a rebuild to see an edit
is not worth it. Embedded is the default because embedded is what ships.

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
- `/up` is answered that way too, and is the health endpoint the hosting probes.
  A 200 there means the interface is present and servable, which is more than a
  route returning a constant could mean. It is a published contract rather than
  a side effect, so a test names it.
- Directories are never listed. Only files in the set are addressable.
- `index.html` is `no-cache`. Hashed asset names are immutable for a year.
  Everything else gets five minutes. Under `-dir` every response is `no-store`
  instead, because an edit answered from the browser's own cache is an edit
  nobody can see.
- Under `-dir`, and only there, the page reloads itself when a file in the
  served directory changes. `index.html` gains one `<script src="/reload.js">`
  on the way out, that script opens an event stream at `/reload`, and the
  server restamps the directory four times a second and speaks when the stamp
  moves. Both halves are same-origin, so `script-src 'self'` and
  `connect-src 'self'` cover it and the policy is untouched. The embedded
  snapshot cannot change under a running process, so it carries none of this.

## Test

    cd serve && go test ./... && go vet ./...

The tests build their own in-memory filesystem, so a change to the real
interface cannot turn them red.
