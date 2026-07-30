package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// fixture is the asset set every test runs against. It is built here rather than
// read from web/ so a change to the real interface cannot turn these tests red.
func fixture() fstest.MapFS {
	return fstest.MapFS{
		"index.html":             {Data: []byte("<!doctype html><title>reviewer</title>")},
		"src/app.js":             {Data: []byte(strings.Repeat("// module\n", 300))},
		"src/tiny.js":            {Data: []byte("export default 1\n")},
		"src/app.css":            {Data: []byte(strings.Repeat(".a{color:red}\n", 200))},
		"assets/app.a1b2c3d4.js": {Data: []byte(strings.Repeat("// hashed\n", 300))},
		"media/clip.mp4":         {Data: bytes.Repeat([]byte("mp4 payload "), 400)},
		"icon.svg":               {Data: []byte(strings.Repeat("<circle/>", 300))},
		"manifest.webmanifest":   {Data: []byte(`{"name":"reviewer","start_url":"/"}`)},
		"sw.js":                  {Data: []byte("// worker\n")},
		"docs/contract.md":       {Data: []byte(strings.Repeat("# heading\n", 300))},
		"fonts/plex.woff2":       {Data: bytes.Repeat([]byte("woff2 payload "), 400)},
		"app/index.html":         {Data: []byte("<!doctype html><title>the app</title>")},
		"pricing.html":           {Data: []byte("<!doctype html><title>pricing</title>")},
		"install.md":             {Data: []byte("# Install\n")},
	}
}

func handlerFor(t *testing.T) http.Handler {
	t.Helper()

	handler, err := newSnapshot(fixture(), "")
	if err != nil {
		t.Fatalf("newSnapshot: %v", err)
	}

	return handler
}

func get(t *testing.T, handler http.Handler, method, target string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(method, target, nil)
	for name, value := range headers {
		request.Header.Set(name, value)
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	return recorder
}

func TestContentTypes(t *testing.T) {
	handler := handlerFor(t)

	cases := map[string]string{
		"/":                       "text/html; charset=utf-8",
		"/index.html":             "text/html; charset=utf-8",
		"/src/app.js":             "text/javascript; charset=utf-8",
		"/src/app.css":            "text/css; charset=utf-8",
		"/icon.svg":               "image/svg+xml",
		"/docs/contract.md":       "text/markdown; charset=utf-8",
		"/media/clip.mp4":         "video/mp4",
		"/fonts/plex.woff2":       "font/woff2",
		"/assets/app.a1b2c3d4.js": "text/javascript; charset=utf-8",
	}

	for target, want := range cases {
		response := get(t, handler, http.MethodGet, target, nil)

		if response.Code != http.StatusOK {
			t.Fatalf("%s: status %d, want 200", target, response.Code)
		}

		if got := response.Header().Get("Content-Type"); got != want {
			t.Errorf("%s: content type %q, want %q", target, got, want)
		}
	}
}

func TestGzipNegotiation(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodGet, "/src/app.js", map[string]string{"Accept-Encoding": "gzip"})

	if got := response.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("content encoding %q, want gzip", got)
	}

	if got := response.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Errorf("vary %q, want Accept-Encoding", got)
	}

	reader, err := gzip.NewReader(response.Body)
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("gzip read: %v", err)
	}

	if want := strings.Repeat("// module\n", 300); string(body) != want {
		t.Error("gzipped body does not decompress to the asset")
	}
}

func TestGzipSkippedWithoutAcceptEncoding(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodGet, "/src/app.js", nil)

	if got := response.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("content encoding %q, want none", got)
	}

	if response.Header().Get("Vary") != "Accept-Encoding" {
		t.Error("vary must be set whether or not gzip was negotiated")
	}
}

func TestGzipSkippedForAlreadyCompressedTypes(t *testing.T) {
	handler := handlerFor(t)

	for _, target := range []string{"/media/clip.mp4", "/fonts/plex.woff2"} {
		response := get(t, handler, http.MethodGet, target, map[string]string{"Accept-Encoding": "gzip"})

		if got := response.Header().Get("Content-Encoding"); got != "" {
			t.Errorf("%s: content encoding %q, want none", target, got)
		}
	}
}

func TestGzipSkippedBelowSizeFloor(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodGet, "/src/tiny.js", map[string]string{"Accept-Encoding": "gzip"})

	if got := response.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("content encoding %q, want none for a file under the floor", got)
	}
}

func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	handler := handlerFor(t)

	for _, target := range []string{"/src/app.js", "/", "/missing/thing.js"} {
		response := get(t, handler, http.MethodGet, target, nil)

		if got := response.Header().Get("Content-Security-Policy"); got != Policy {
			t.Errorf("%s: policy %q, want the documented policy", target, got)
		}

		if got := response.Header().Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("%s: referrer policy %q", target, got)
		}

		if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: nosniff %q", target, got)
		}
	}
}

func TestPolicyContents(t *testing.T) {
	for _, directive := range []string{
		"script-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'self'",
		"connect-src 'self' https:",
		"img-src 'self' data: blob:",
		"media-src 'self' blob:",
		"font-src 'self' https://fonts.gstatic.com",
	} {
		if !strings.Contains(Policy, directive) {
			t.Errorf("policy is missing %q", directive)
		}
	}
}

func TestPolicyOverride(t *testing.T) {
	handler, err := newSnapshot(fixture(), "default-src 'none'")
	if err != nil {
		t.Fatalf("newSnapshot: %v", err)
	}

	response := get(t, handler, http.MethodGet, "/", nil)

	if got := response.Header().Get("Content-Security-Policy"); got != "default-src 'none'" {
		t.Errorf("policy %q, want the override", got)
	}
}

func TestSinglePageFallback(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodGet, "/review/octocat/hello/12", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", response.Code)
	}

	if !strings.Contains(response.Body.String(), "<title>reviewer</title>") {
		t.Error("an unknown route must serve index.html")
	}
}

// A directory holding its own index.html is served that index, not the
// single-page fallback.
//
// The site puts the marketing pages at the root and the interface under /app/,
// and the marketing page frames /app/ to show the real product. Answering that
// frame with the root index.html means the marketing page frames itself, and
// every nested copy frames it again: a loop that takes the renderer down.
func TestDirectoryIndex(t *testing.T) {
	handler := handlerFor(t)

	for _, target := range []string{"/app/", "/app/?demo=1"} {
		response := get(t, handler, http.MethodGet, target, nil)

		if response.Code != http.StatusOK {
			t.Errorf("%s: status %d, want 200", target, response.Code)
		}

		if !strings.Contains(response.Body.String(), "<title>the app</title>") {
			t.Errorf("%s: served the root index instead of the directory's own", target)
		}
	}
}

// A directory asked for without its trailing slash is redirected to it, rather
// than answered where it stands.
//
// The document is the same either way, and that is the trap: at /app the
// browser reads the base as /, so the page's own "./src/app/view.js" is fetched
// from /src/app/view.js, which is the site's root and has no such file. Every
// relative reference in the interface breaks at once, the modules 404, and the
// page loads blank with nothing saying why. Nothing about the response looks
// wrong from here, which is why this is worth a test of its own.
func TestDirectoryRedirectsToItsSlash(t *testing.T) {
	handler := handlerFor(t)

	cases := map[string]string{
		"/app":        "/app/",
		"/app?demo=1": "/app/?demo=1",
	}

	for target, want := range cases {
		response := get(t, handler, http.MethodGet, target, nil)

		if response.Code != http.StatusMovedPermanently {
			t.Errorf("%s: status %d, want 301", target, response.Code)
		}

		if got := response.Header().Get("Location"); got != want {
			t.Errorf("%s: sent to %q, want %q", target, got, want)
		}
	}
}

// TestUpIsTheHealthEndpoint pins /up, which is a published contract rather than
// an internal choice: Basecamp ONCE probes it, and kamal-proxy refuses to
// register a target that does not answer there.
//
// There is no /up route, and deliberately so. /up carries no extension, so it
// takes the client-side route path and is answered with the interface itself.
// That proves strictly more than a route returning a constant would: a 200 here
// means the embedded interface is present and servable, which is the whole job
// of this process, where a constant would keep saying yes over an image whose
// index.html had gone missing.
//
// What it must not be is an accident. Without this test, a change to the
// fallback would take the health endpoint with it and nothing would say so
// until a deploy timed out two minutes in.
func TestUpIsTheHealthEndpoint(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodGet, "/up", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("/up: status %d, want 200: ONCE's health check is a GET /up", response.Code)
	}

	if !strings.Contains(response.Body.String(), "<title>reviewer</title>") {
		t.Error("/up must answer with the interface, which is what makes the 200 mean something")
	}
}

// A page is reachable without naming its file extension.
//
// The addresses this site hands out are read aloud and typed by hand:
// dev.review/install is the install document and dev.review/pricing is the
// pricing page. Both are files with extensions on disk, and neither should have
// to be spelt that way to be fetched.
//
// It matters most for the install document, which is fetched by whatever the
// reader has to hand. Without this, /install falls to the single-page fallback
// and answers with the marketing homepage: an installer that pipes the front
// page into whatever was going to run it.
func TestExtensionIsOptional(t *testing.T) {
	handler := handlerFor(t)

	cases := map[string]string{
		"/pricing": "<title>pricing</title>",
		"/install": "# Install",
	}

	for target, want := range cases {
		response := get(t, handler, http.MethodGet, target, nil)

		if response.Code != http.StatusOK {
			t.Errorf("%s: status %d, want 200", target, response.Code)
		}

		if !strings.Contains(response.Body.String(), want) {
			t.Errorf("%s: served something other than the page it names", target)
		}
	}
}

// And the type has to be the file's own, or /install is downloaded as HTML and
// /pricing is offered as a file to save.
func TestExtensionlessKeepsItsType(t *testing.T) {
	handler := handlerFor(t)

	cases := map[string]string{
		"/pricing": "text/html; charset=utf-8",
		"/install": "text/markdown; charset=utf-8",
	}

	for target, want := range cases {
		if got := get(t, handler, http.MethodGet, target, nil).Header().Get("Content-Type"); got != want {
			t.Errorf("%s: content type %q, want %q", target, got, want)
		}
	}
}

func TestMissingFileWithExtensionIs404(t *testing.T) {
	handler := handlerFor(t)

	for _, target := range []string{"/src/gone.js", "/style/gone.css", "/gone.png"} {
		response := get(t, handler, http.MethodGet, target, nil)

		if response.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, response.Code)
		}

		if strings.Contains(response.Body.String(), "<title>") {
			t.Errorf("%s: served the interface instead of a 404", target)
		}
	}
}

func TestETagAndNotModified(t *testing.T) {
	handler := handlerFor(t)

	first := get(t, handler, http.MethodGet, "/src/app.js", nil)

	tag := first.Header().Get("ETag")
	if tag == "" || strings.HasPrefix(tag, "W/") {
		t.Fatalf("etag %q, want a strong tag", tag)
	}

	second := get(t, handler, http.MethodGet, "/src/app.js", map[string]string{"If-None-Match": tag})

	if second.Code != http.StatusNotModified {
		t.Fatalf("status %d, want 304", second.Code)
	}

	if second.Body.Len() != 0 {
		t.Error("a 304 must carry no body")
	}

	if second.Header().Get("Content-Security-Policy") == "" {
		t.Error("a 304 must still carry the security headers")
	}
}

func TestETagDiffersByEncoding(t *testing.T) {
	handler := handlerFor(t)

	plain := get(t, handler, http.MethodGet, "/src/app.js", nil).Header().Get("ETag")
	zipped := get(t, handler, http.MethodGet, "/src/app.js", map[string]string{"Accept-Encoding": "gzip"}).Header().Get("ETag")

	if plain == zipped {
		t.Error("the gzip representation needs its own strong etag")
	}
}

func TestHead(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodHead, "/src/app.js", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", response.Code)
	}

	if response.Body.Len() != 0 {
		t.Error("HEAD must carry no body")
	}

	if response.Header().Get("Content-Length") == "" {
		t.Error("HEAD must report the length the body would have had")
	}

	if response.Header().Get("Content-Type") != "text/javascript; charset=utf-8" {
		t.Error("HEAD must report the content type")
	}
}

func TestNoDirectoryListing(t *testing.T) {
	handler := handlerFor(t)

	for _, target := range []string{"/src/", "/src", "/docs/"} {
		response := get(t, handler, http.MethodGet, target, nil)

		if strings.Contains(response.Body.String(), "app.js") {
			t.Errorf("%s: listed the directory", target)
		}
	}
}

func TestCaching(t *testing.T) {
	handler := handlerFor(t)

	cases := map[string]string{
		"/":                       "no-cache",
		"/index.html":             "no-cache",
		"/assets/app.a1b2c3d4.js": "public, max-age=31536000, immutable",
		"/src/app.js":             "public, max-age=300",
	}

	for target, want := range cases {
		if got := get(t, handler, http.MethodGet, target, nil).Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: cache control %q, want %q", target, got, want)
		}
	}
}

// TestManifestIsServedAsAManifest pins the type on the file that makes the
// interface installable. A manifest sent as anything else is ignored outright,
// and nosniff means the browser will not guess its way to the right answer, so
// the whole install offer rests on this one string being in the types map.
func TestManifestIsServedAsAManifest(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodGet, "/manifest.webmanifest", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", response.Code)
	}

	if got := response.Header().Get("Content-Type"); got != "application/manifest+json" {
		t.Errorf("content type %q, want application/manifest+json", got)
	}
}

// TestServiceWorkerIsAlwaysRevalidated holds the header that lets a deploy
// reach a browser that has already installed the interface.
//
// The worker's own script is how a new release announces itself. A browser
// holding a copy of it for five minutes is a browser that keeps the previous
// worker for five minutes, and the reader has no way to know they are looking
// at one. Revalidating every time costs a conditional request and removes that
// whole class of confusion.
func TestServiceWorkerIsAlwaysRevalidated(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodGet, "/sw.js", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: the worker has to be at the root or its scope is not the whole app", response.Code)
	}

	if got := response.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("cache control %q, want no-cache", got)
	}

	if got := response.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Errorf("content type %q, want javascript", got)
	}
}

func TestTraversalCannotEscape(t *testing.T) {
	handler := handlerFor(t)

	for _, target := range []string{
		"/../go.mod",
		"/src/../../go.mod",
		"/%2e%2e/go.mod",
		"/src/%2e%2e%2f%2e%2e%2fgo.mod",
	} {
		response := get(t, handler, http.MethodGet, target, nil)

		if strings.Contains(response.Body.String(), "module reviewer") {
			t.Fatalf("%s: escaped the asset set", target)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	handler := handlerFor(t)

	response := get(t, handler, http.MethodPost, "/src/app.js", nil)

	if response.Code != http.StatusMethodNotAllowed {
		t.Errorf("status %d, want 405", response.Code)
	}
}

func TestLiveAsksThePageToListenForReloads(t *testing.T) {
	handler := newLive(fixture(), "")

	response := get(t, handler, http.MethodGet, "/", nil)

	if !strings.Contains(response.Body.String(), `src="/reload.js"`) {
		t.Error("the served interface must pull in the reload listener")
	}

	if got := response.Header().Get("Content-Security-Policy"); got != Policy {
		t.Errorf("policy %q, want the documented policy", got)
	}
}

func TestLiveServesTheReloadListenerAsSameOriginScript(t *testing.T) {
	handler := newLive(fixture(), "")

	response := get(t, handler, http.MethodGet, "/reload.js", nil)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", response.Code)
	}

	if got := response.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Errorf("content type %q, want javascript", got)
	}

	if !strings.Contains(response.Body.String(), "EventSource") {
		t.Error("the listener must open the event stream")
	}
}

func TestLiveNeverLetsTheBrowserHoldAnEdit(t *testing.T) {
	handler := newLive(fixture(), "")

	for _, target := range []string{"/", "/src/app.js", "/src/app.css"} {
		if got := get(t, handler, http.MethodGet, target, nil).Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: cache control %q, want no-store", target, got)
		}
	}
}

func TestReloadIsAbsentFromWhatShips(t *testing.T) {
	handler := handlerFor(t)

	if response := get(t, handler, http.MethodGet, "/reload.js", nil); response.Code != http.StatusNotFound {
		t.Errorf("/reload.js: status %d, want 404", response.Code)
	}

	// /reload has no extension, so the shipped server answers it the way it
	// answers any client-side route. What must not be there is the stream.
	if got := get(t, handler, http.MethodGet, "/reload", nil).Header().Get("Content-Type"); got == "text/event-stream" {
		t.Error("the shipped server must not open a reload stream")
	}

	if strings.Contains(get(t, handler, http.MethodGet, "/", nil).Body.String(), "reload.js") {
		t.Error("the shipped interface must not carry the reload listener")
	}
}

func TestReloadStreamSpeaksWhenAFileChanges(t *testing.T) {
	// A real directory, not the MapFS the other tests share. The watcher walks
	// the tree from its own goroutine, so editing a map here would be a data
	// race against that walk, and a race is not a timing problem you can wait
	// out: the edit can simply never be seen. A directory is also what -dir
	// actually serves, so this exercises the path the reader has.
	dir := t.TempDir()

	write := func(name, body string) {
		t.Helper()

		path := filepath.Join(dir, filepath.FromSlash(name))

		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("make %s: %v", name, err)
		}

		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	write("index.html", "<!doctype html><title>reviewer</title>")
	write("src/app.js", "// module\n")

	server := httptest.NewServer(newLive(os.DirFS(dir), ""))
	defer server.Close()

	response, err := http.Get(server.URL + "/reload")
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer response.Body.Close()

	if got := response.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content type %q, want an event stream", got)
	}

	events := make(chan string, 1)

	go func() {
		line, err := bufio.NewReader(response.Body).ReadString('\n')
		if err != nil {
			events <- "ERR: " + err.Error()
			return
		}

		events <- line
	}()

	// Keep editing until it is heard. The handler takes its baseline after it
	// has flushed the headers this request has already returned from, so a
	// single edit can land first and be baked into the baseline, leaving the
	// stream correctly silent about a change it believes it was born with. One
	// edit is therefore a race with no winner declared; edits until the answer
	// comes are not. Each one is longer than the last, so whenever the baseline
	// was taken, something after it differs.
	done := make(chan struct{})
	defer close(done)

	// It reports a write failure through the same channel rather than calling
	// t.Fatalf, which off the test's own goroutine would end this one quietly
	// and leave the deadline blaming the watcher for a disk that said no.
	go func() {
		path := filepath.Join(dir, "src", "app.js")

		for attempt := 0; ; attempt++ {
			select {
			case <-done:
				return
			default:
			}

			body := []byte("// edited" + strings.Repeat("!", attempt) + "\n")

			if err := os.WriteFile(path, body, 0o644); err != nil {
				events <- "ERR: write: " + err.Error()
				return
			}

			time.Sleep(100 * time.Millisecond)
		}
	}()

	select {
	case line := <-events:
		if !strings.HasPrefix(line, "data:") {
			t.Errorf("stream said %q, want an event", line)
		}
	// The watcher polls every 250ms, so a healthy run answers almost at once
	// and never spends this budget. It is set high because it is only ever
	// spent on failure, and a ceiling tight enough to trip on a loaded machine
	// buys nothing except a red build that means nothing.
	case <-time.After(30 * time.Second):
		t.Error("the stream stayed silent through an edit")
	}
}
