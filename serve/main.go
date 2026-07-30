// Command serve hands out the reviewer interface as static files.
//
// The interface is a browser application. Storage goes through adapters
// configured in the page, and GitHub is called from the page with the reader's
// own token, so this process holds no credential and knows nothing about a
// review. It exists to answer requests for files with the right type, the right
// cache headers, and a policy that keeps the origin closed.
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
)

// The built interface, embedded so a release is one file with nothing to
// install beside it.
//
// go:embed cannot reach outside this module's directory, so the build copies
// the repository's web/ to serve/web/ before compiling. See README.md.
//
//go:embed all:web
var site embed.FS

func main() {
	address := flag.String("addr", ":8080", "address to listen on")
	dir := flag.String("dir", "", "serve this directory from disk instead of the embedded copy (development)")
	policy := flag.String("csp", "", "replace the content security policy (see README)")
	flag.Parse()

	handler, err := build(*dir, *policy)
	if err != nil {
		log.Fatalf("serve: %v", err)
	}

	log.Printf("serve: listening on %s", *address)
	log.Fatal(http.ListenAndServe(*address, handler))
}

// build chooses between the embedded snapshot and a directory on disk.
//
// The embedded case is the default because it is what ships. A directory is for
// development, where a reload has to pick up an edit without a rebuild.
func build(dir, policy string) (http.Handler, error) {
	if dir != "" {
		return newLive(os.DirFS(dir), policy), nil
	}

	files, err := fs.Sub(site, "web")
	if err != nil {
		return nil, err
	}

	return newSnapshot(files, policy)
}
