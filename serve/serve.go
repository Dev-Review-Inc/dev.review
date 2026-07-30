package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// Policy is the content security policy applied to every response.
//
// The reader's GitHub token lives in local storage on this origin, so the
// policy exists to make sure nothing but this origin's own code can ever run
// here and read it.
const Policy = "default-src 'self'; " +
	// The one that matters. The token is readable by any script this page runs,
	// so script may come from this origin and nowhere else. object-src,
	// base-uri and form-action close the remaining ways to get code or a
	// destination in without a script tag.
	"script-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'none'; " +
	"form-action 'none'; " +
	// Set explicitly, because default-src is not a fallback for it: without
	// this the interface can be framed and clickjacked from anywhere.
	//
	// 'self' rather than 'none' because the marketing site pins the real
	// interface into the page as a same-origin frame, so that the demo is the
	// product rather than a screenshot of it. An attacker cannot serve a page
	// on this origin, so allowing this origin to frame itself closes nothing:
	// the clickjacking this directive is here to stop is a cross-origin frame,
	// and that stays refused.
	"frame-ancestors 'self'; " +
	// The storage adapter talks to the customer's own S3-compatible endpoint,
	// configured at runtime and unknown when this binary is built, alongside
	// https://api.github.com. An allowlist baked in here would mean only
	// endpoints we had heard of would work, which breaks the promise that the
	// storage is theirs. The honest tradeoff: this does widen where data could
	// be sent to any https origin, but with script-src 'self' there is no
	// attacker script on the page to do the sending, so the exposure is bounded
	// by our own code. Plain http is still refused.
	"connect-src 'self' https:; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	// 'self' is here so a font shipped in the binary can load. Fonts cannot
	// execute, and the interface is designed around IBM Plex Sans and
	// JetBrains Mono.
	"font-src 'self' https://fonts.gstatic.com; " +
	// QA evidence comes back from the storage adapter as bytes and is shown
	// through blob URLs rather than fetched over the network, so blob: has to
	// be a permitted source for images and video.
	"img-src 'self' data: blob:; " +
	"media-src 'self' blob:"

// types maps an extension to the content type sent for it.
//
// These are set here rather than left to mime.TypeByExtension, which consults
// the host's MIME database: on a machine whose /etc/mime.types calls .js
// "application/x-javascript" the browser refuses the module and the interface
// does not start. A server whose behaviour depends on the box it is unpacked on
// is not deployable.
var types = map[string]string{
	".html": "text/html; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".mjs":  "text/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	// The web app manifest. A browser that gets anything else here ignores the
	// file and never offers to install, and nosniff means it cannot recover by
	// guessing, so this entry is the whole of what makes the app installable.
	".webmanifest": "application/manifest+json",
	".md":          "text/markdown; charset=utf-8",
	".map":         "application/json; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".webp":        "image/webp",
	".ico":         "image/vnd.microsoft.icon",
	".woff2":       "font/woff2",
	".mp4":         "video/mp4",
	".webm":        "video/webm",
	".txt":         "text/plain; charset=utf-8",
}

// compressible lists the extensions worth gzipping. Everything absent from it
// is left alone, which covers the already-compressed formats: gzipping an mp4
// or a woff2 spends time and memory to make the response marginally larger.
var compressible = map[string]bool{
	".html":        true,
	".js":          true,
	".mjs":         true,
	".css":         true,
	".json":        true,
	".webmanifest": true,
	".map":         true,
	".md":          true,
	".svg":         true,
	".txt":         true,
}

// floor is the size below which gzip is not worth it. A response this small
// fits in one packet either way, so compressing it buys nothing and costs the
// decompression.
const floor = 1024

// hashed matches an asset path with a content hash in its name, as produced by
// a bundler. Those are safe to cache forever because a change to the file
// changes its name; everything else gets a short life so a redeploy is picked
// up without anyone clearing a cache.
var hashed = regexp.MustCompile(`[.-][0-9a-f]{8,}\.[0-9a-z]+$`)

// asset is one file, ready to send.
type asset struct {
	contentType string
	cache       string
	body        []byte
	gzipped     []byte // nil when compressing this file is not worth it
	etag        string
	gzipETag    string
}

// source finds an asset by its path within the site.
type source interface {
	lookup(name string) (*asset, bool)
}

// snapshot holds every asset prepared once at startup.
//
// The asset set is small and fixed, so the gzipped bytes are computed here
// rather than per request: it trades a little memory at boot for no CPU per
// response, which is what a single self-hosted instance wants.
type snapshot map[string]*asset

func (s snapshot) lookup(name string) (*asset, bool) {
	found, ok := s[name]

	return found, ok
}

// live reads from disk on every request so an edit shows up on reload. It is
// for development only, which is why the cost of hashing and compressing per
// request is acceptable here and not in snapshot.
type live struct {
	files fs.FS
}

func (l live) lookup(name string) (*asset, bool) {
	body, err := fs.ReadFile(l.files, name)
	if err != nil {
		return nil, false
	}

	// A directory read succeeds on some filesystems; only files are servable.
	info, err := fs.Stat(l.files, name)
	if err != nil || info.IsDir() {
		return nil, false
	}

	if name == "index.html" {
		body = append(body, listenerTag...)
	}

	ready := prepare(name, body)
	// The shipped cache lives are wrong here in both directions: five minutes on
	// a module means an edit the browser answers from its own copy, which is an
	// edit the reader cannot see, and seeing it is the whole point of -dir.
	ready.cache = "no-store"

	return ready, true
}

// newSnapshot builds a handler over every file, prepared once at startup.
//
// An empty policy means the documented one; anything else replaces it whole,
// for hosting that needs a different shape and accepts owning the consequences.
func newSnapshot(files fs.FS, policy string) (http.Handler, error) {
	assets := snapshot{}

	err := fs.WalkDir(files, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if entry.IsDir() {
			return nil
		}

		body, err := fs.ReadFile(files, name)
		if err != nil {
			return err
		}

		assets[name] = prepare(name, body)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return secured(handler(assets), policy), nil
}

// newLive builds a handler that reads from a filesystem on every request, for
// development against the working tree. It carries the reload affordance, which
// exists in this mode and no other.
func newLive(files fs.FS, policy string) http.Handler {
	return secured(reloadRoutes(files, handler(live{files: files})), policy)
}

// prepare works out everything about a file that does not depend on the
// request: its type, its cache life, its strong tag, and its gzipped form.
func prepare(name string, body []byte) *asset {
	extension := strings.ToLower(path.Ext(name))

	sum := sha256.Sum256(body)
	tag := hex.EncodeToString(sum[:])

	ready := &asset{
		contentType: contentType(extension),
		cache:       cache(name),
		body:        body,
		etag:        `"` + tag + `"`,
		// A different representation needs a different strong tag, or a cache
		// holding the gzipped copy will hand it to a client that cannot read it.
		gzipETag: `"` + tag + `-gzip"`,
	}

	if compressible[extension] && len(body) >= floor {
		ready.gzipped = compress(body)
	}

	return ready
}

// contentType falls back to a type the browser will not execute or render, so
// an unrecognised extension is inert rather than guessed at.
func contentType(extension string) string {
	if found, ok := types[extension]; ok {
		return found
	}

	return "application/octet-stream"
}

// cache decides how long a file may be held.
//
// index.html is revalidated every time: it names the current asset paths, so a
// stale copy pins the whole application to an old release. sw.js is revalidated
// for the same reason one step further out: it is the script that decides what
// an installed copy of the interface may answer from its own cache, so a held
// copy of it holds the previous release's answers with it. Hashed asset names
// can never change contents under the same name, so they are immutable for a
// year. Everything else gets five minutes, long enough to help a reload and
// short enough that a deploy is live without anyone being told to hard refresh.
func cache(name string) string {
	if name == "index.html" || name == "sw.js" {
		return "no-cache"
	}

	if hashed.MatchString(name) {
		return "public, max-age=31536000, immutable"
	}

	return "public, max-age=300"
}

// compress gzips at the best ratio available. This runs once per asset at
// startup, so the time it takes is paid before the first request rather than
// during it.
func compress(body []byte) []byte {
	var buffer bytes.Buffer

	writer, err := gzip.NewWriterLevel(&buffer, gzip.BestCompression)
	if err != nil {
		return nil
	}

	if _, err := writer.Write(body); err != nil {
		return nil
	}

	if err := writer.Close(); err != nil {
		return nil
	}

	// A file that does not shrink is better sent as it is.
	if buffer.Len() >= len(body) {
		return nil
	}

	return buffer.Bytes()
}

// secured applies the security headers to every response, including the ones
// that fail. Applying them per route is how a file-serving route ends up
// unpoliced, so there is one wrapper around everything and no way past it.
func secured(next http.Handler, policy string) http.Handler {
	if policy == "" {
		policy = Policy
	}

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Security-Policy", policy)
		writer.Header().Set("Referrer-Policy", "no-referrer")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(writer, request)
	})
}

// handler serves the site out of one source.
//
// There is no http.FileServer here on purpose: it lists directories, redirects
// on index.html, and reads content types from the host. Looking a path up in a
// known set of files does none of those things.
func handler(files source) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			writer.Header().Set("Allow", "GET, HEAD")
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)

			return
		}

		name := resolve(request.URL.Path)

		if found, ok := files.lookup(name); ok {
			send(writer, request, found)

			return
		}

		// A directory holding its own index.html is a page in its own right, and
		// is served that index rather than the fallback below. The site puts the
		// marketing pages at the root and the interface under /app/; without
		// this, a request for /app/ is answered with the marketing page, which
		// frames /app/ to show the product and so frames itself without end.
		if path.Ext(name) == "" {
			if _, ok := files.lookup(path.Join(name, "index.html")); ok {
				// Answered where it stands, /app would serve the right document
				// against the wrong base: the browser reads the base of /app as
				// /, so the page's own "./src/app/view.js" is fetched from the
				// site's root, where there is no such file. Every relative
				// reference breaks at once and the page loads blank. The slash
				// is what makes the directory a directory, so it is asked for
				// rather than assumed.
				if !strings.HasSuffix(request.URL.Path, "/") {
					http.Redirect(writer, request, request.URL.Path+"/"+query(request), http.StatusMovedPermanently)

					return
				}

				if found, ok := files.lookup(path.Join(name, "index.html")); ok {
					send(writer, request, found)

					return
				}
			}
		}

		// A page is reachable without naming its extension. The addresses this
		// site hands out get read aloud and typed by hand - dev.review/install,
		// dev.review/pricing - and having to spell the extension makes a worse
		// address for no gain.
		//
		// It matters most for the install document. Without this, /install takes
		// the fallback below and answers with the marketing homepage, which is an
		// installer that hands the front page to whatever was about to run it.
		//
		// Order is deliberate: .html first, so a page always wins over a document
		// that happens to share its name.
		if path.Ext(name) == "" {
			for _, extension := range []string{".html", ".md"} {
				if found, ok := files.lookup(name + extension); ok {
					send(writer, request, found)

					return
				}
			}
		}

		// A path that names a file type and is not there is a broken reference.
		// Answering it with the interface would hand back HTML for a missing
		// module, and the browser's error would be about syntax rather than
		// about the file being absent.
		if path.Ext(name) != "" {
			http.Error(writer, "not found", http.StatusNotFound)

			return
		}

		// Anything else is a client-side route. The interface is served at the
		// requested address so the router can read it.
		//
		// /up arrives here too, and that is the deploy contract rather than a
		// coincidence: Basecamp ONCE health checks it, and a 200 from this branch
		// says the interface is present and servable, which is more than a route
		// returning a constant could say. TestUpIsTheHealthEndpoint holds it.
		index, ok := files.lookup("index.html")
		if !ok {
			http.Error(writer, "interface missing", http.StatusInternalServerError)

			return
		}

		send(writer, request, index)
	})
}

// resolve turns a request path into a path within the asset set.
//
// path.Clean on an absolute path resolves every .. against the root, so no
// request can name anything outside the set, and a name that survives cleaning
// still has to exist in it.
func resolve(requested string) string {
	name := strings.TrimPrefix(path.Clean("/"+requested), "/")

	if name == "" {
		return "index.html"
	}

	return name
}

// send writes one asset, negotiating encoding and honouring a conditional
// request.
func send(writer http.ResponseWriter, request *http.Request, found *asset) {
	header := writer.Header()

	header.Set("Content-Type", found.contentType)
	header.Set("Cache-Control", found.cache)
	// Set whether or not gzip was chosen: a cache keying on the URL alone would
	// otherwise serve one client's encoding to another.
	header.Set("Vary", "Accept-Encoding")

	body := found.body
	etag := found.etag

	if found.gzipped != nil && acceptsGzip(request) {
		header.Set("Content-Encoding", "gzip")

		body = found.gzipped
		etag = found.gzipETag
	}

	header.Set("ETag", etag)

	if matches(request.Header.Get("If-None-Match"), etag) {
		writer.WriteHeader(http.StatusNotModified)

		return
	}

	header.Set("Content-Length", strconv.Itoa(len(body)))

	if request.Method == http.MethodHead {
		writer.WriteHeader(http.StatusOK)

		return
	}

	writer.WriteHeader(http.StatusOK)
	io.Copy(writer, bytes.NewReader(body))
}

// acceptsGzip reads the encodings the client offered. The quality values are
// ignored: a client that lists gzip at all can read it, and one that cannot
// does not list it.
func acceptsGzip(request *http.Request) bool {
	for _, offered := range strings.Split(request.Header.Get("Accept-Encoding"), ",") {
		name, _, _ := strings.Cut(offered, ";")

		if strings.TrimSpace(name) == "gzip" {
			return true
		}
	}

	return false
}

// matches compares an If-None-Match header against a strong tag. A client may
// send several, or the wildcard, which matches anything that exists.
func matches(header, etag string) bool {
	if header == "" {
		return false
	}

	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)

		if candidate == "*" || candidate == etag {
			return true
		}
	}

	return false
}

// query is the request's query string, put back on a redirect.
//
// A reader sent from /app to /app/ must arrive with what they asked for still
// attached: the demo is reached with ?demo=1, and dropping it here would send
// them to the plain interface and look like the link was wrong.
func query(request *http.Request) string {
	if request.URL.RawQuery == "" {
		return ""
	}

	return "?" + request.URL.RawQuery
}
