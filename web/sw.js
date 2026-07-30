// The offline shell.
//
// This worker exists to make the interface start without a network, and for
// nothing else. Everything past that start is a review in the reader's own
// bucket or folder, or a call to api.github.com carrying their token. None of
// it is ours, so none of it is held here.
//
// It is a module worker, which is what the rest of web/ is, so the one rule
// with teeth in it - `ours` - can be imported by a test rather than reasoned
// about from a comment.

// Where the shell is kept. The name is the version: bump it and activate drops
// what was there whole, which is the way out if the shape of what is stored
// here ever changes. It is not bumped per deploy, and does not need to be,
// because nothing below prefers a stored copy to a fresh one.
const SHELL = "shell-1";

// The document, under one key. Every client-side route (/review/org/app/42)
// is answered with index.html by the server, so storing each route under its
// own URL would keep many copies of one document and still miss the next route
// a reader opened.
const DOCUMENT = "/";

/**
 * Whether this is a request the worker may answer.
 *
 * Same origin and a plain read, and nothing else. Cross-origin is the reader's
 * storage and GitHub: a cached copy of either would be a stale review at best,
 * and at worst this worker replaying a request that carried their token. The
 * development reload stream is same-origin but never ends, so holding a copy of
 * it would hold the response open for as long as the server ran.
 *
 * @param {Request} request the request the page made
 * @param {string} origin where this worker is installed
 * @returns {boolean} true when the worker may answer it
 */
export function ours(request, origin) {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);

  if (url.origin !== origin) return false;

  return url.pathname !== "/reload" && url.pathname !== "/reload.js";
}

self.addEventListener("install", (event) => {
  // Only the document is fetched up front, so a worker installed on a first
  // visit can already start the app. Every module the document pulls in is
  // stored as it is fetched, which is why there is no list of files here to
  // fall out of step with what web/ actually holds.
  //
  // skipWaiting because nothing here pins a version: the new worker answers the
  // same way the old one did, from the network, so there is no reason to make
  // it queue behind an open tab.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((shell) => shell.add(DOCUMENT))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Anything under another name is a shell from a version of this worker that
  // no longer exists. claim() so the tab that installed this worker is under it
  // straight away, rather than being offline-capable only from its next load.
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== SHELL).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!ours(event.request, self.location.origin)) return;

  event.respondWith(fresh(event.request));
});

/**
 * Answer from the network, and keep a copy in case there is no network.
 *
 * The tempting design is the other way round - answer from the cache, and
 * refresh behind it - because it is faster. It is also how an installed app
 * ends up running last week's JavaScript after a deploy, with no way for the
 * reader to tell and nothing to do about it but clear the site's data. A shell
 * that always prefers the fresh copy cannot do that. The server already keeps
 * the cost small: index.html revalidates, and a module that has not changed
 * comes back as a 304.
 *
 * @param {Request} request a request `ours` accepted
 * @returns {Promise<Response>} the fresh copy, or the last one that arrived
 */
async function fresh(request) {
  const key = request.mode === "navigate" ? DOCUMENT : request;

  try {
    const response = await fetch(request);

    // 200 rather than ok: a range response is a fragment of a file, and a cache
    // holding one would answer a later whole-file request with the fragment.
    if (response.status === 200) {
      const copy = response.clone();

      // Not awaited. The page is being answered from the network either way,
      // and should not wait on a write it is not reading from.
      caches.open(SHELL).then((shell) => shell.put(key, copy));
    }

    return response;
  } catch (unreachable) {
    const held = await caches.match(key);

    if (held) return held;

    throw unreachable;
  }
}
