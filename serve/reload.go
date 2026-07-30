// Hot reloading, for working on the interface itself.
//
// It is wired into the -dir handler and nowhere else. What ships is the
// embedded snapshot, which cannot change under a running process, so there is
// nothing for a reloader to watch there and no reason to expose one.
//
// The shape is fixed by the content security policy rather than chosen: with
// script-src 'self' the page cannot carry an inline snippet, so the listener is
// a served file, and connect-src 'self' already permits a same-origin event
// stream. Nothing about hot reloading asks the policy to bend.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/http"
	"time"
)

// poll is how often the served directory is restamped. Short enough that a save
// and a glance at the browser feel like one action, long enough that walking a
// few hundred files costs nothing noticeable.
const poll = 250 * time.Millisecond

// listenerTag is appended to index.html in -dir mode. It is appended rather
// than woven into the document because the document belongs to the interface,
// not to the server: nothing in web/ has to know this mode exists.
const listenerTag = "\n<script src=\"/reload.js\"></script>\n"

// listenerSource reloads the page when the stream says the directory changed.
// The stream only speaks when something actually changed, so there is no state
// to keep on this side.
const listenerSource = `new EventSource("/reload").addEventListener("message", () => location.reload())
`

// listener is the script as an asset, prepared once. no-store because a cached
// listener is one that outlives the server that served it.
var listener = script()

func script() *asset {
	ready := prepare("reload.js", []byte(listenerSource))
	ready.cache = "no-store"

	return ready
}

// reloadRoutes puts the stream and the listener in front of the served files.
func reloadRoutes(files fs.FS, next http.Handler) http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /reload", reloader(files, poll))

	mux.HandleFunc("GET /reload.js", func(writer http.ResponseWriter, request *http.Request) {
		send(writer, request, listener)
	})

	mux.Handle("/", next)

	return mux
}

// reloader holds the response open and writes an event every time the stamp of
// the served directory moves.
//
// Polling rather than a filesystem watcher: a watcher means a dependency and a
// per-platform event model, and this walks a directory of a few hundred small
// files, which is cheaper than the network round trip it replaces.
func reloader(files fs.FS, every time.Duration) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		header := writer.Header()
		header.Set("Content-Type", "text/event-stream")
		header.Set("Cache-Control", "no-store")

		control := http.NewResponseController(writer)

		writer.WriteHeader(http.StatusOK)
		control.Flush()

		// The stamp at the moment the page connected is the baseline, so a page
		// that connects after an edit is already current and is not reloaded for
		// a change it was born with.
		known := stamp(files)

		ticker := time.NewTicker(every)
		defer ticker.Stop()

		for {
			select {
			case <-request.Context().Done():
				return
			case <-ticker.C:
				current := stamp(files)
				if current == known {
					continue
				}

				known = current

				if _, err := fmt.Fprint(writer, "data: reload\n\n"); err != nil {
					return
				}

				control.Flush()
			}
		}
	}
}

// stamp reduces the served directory to a string that changes when any file in
// it does.
//
// Size is folded in alongside the modification time because an editor that
// writes through an existing inode on a filesystem with a coarse clock can
// leave the time where it was, and a change nobody notices is worse than a
// reload nobody asked for.
func stamp(files fs.FS) string {
	sum := sha256.New()

	fs.WalkDir(files, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return nil
		}

		fmt.Fprintf(sum, "%s %d %d\n", name, info.Size(), info.ModTime().UnixNano())

		return nil
	})

	return hex.EncodeToString(sum.Sum(nil))
}
