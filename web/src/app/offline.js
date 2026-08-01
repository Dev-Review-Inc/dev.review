// Turning the offline shell on, and knowing when not to.

import { say } from "./dom.js";

/**
 * Whether the development server is behind this page.
 *
 * Under -dir the server appends its reload listener to index.html, and in no
 * other mode does it. That tag is the page's own evidence of which server it
 * came from, so nothing in web/ has to be told which mode it is running under
 * and no flag has to be flipped back before a commit.
 *
 * @param {Document} page the document
 * @returns {boolean} true when an edit is meant to show up on reload
 */
export function developing(page) {
  return Boolean(page.querySelector('script[src="/reload.js"]'));
}

/**
 * Register the worker that makes the interface start without a network.
 *
 * @param {Document} page the document
 * @param {Navigator} agent the browser
 * @param {CacheStorage} store the browser's caches
 * @returns {Promise<boolean>} true when a worker was registered
 */
export async function offline(page, agent, store) {
  if (!agent?.serviceWorker) return false;

  if (developing(page)) {
    // A worker registered by a visit to the shipped server on this same origin
    // outlives the switch to -dir. Left alone it would go on answering while
    // the reload listener reloaded a page that never appeared to change, which
    // is a morning nobody should have to spend.
    const registrations = await agent.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if (store) {
      const names = await store.keys();
      await Promise.all(names.map((name) => store.delete(name)));
    }

    return false;
  }

  // Relative, because the interface is not promised the root: the site can
  // serve it under a subpath, and a worker asked for at "/sw.js" from there
  // would claim a scope the app does not own. Beside the document, its scope
  // is exactly the tree the document came from, which is every route it has.
  await agent.serviceWorker.register("./sw.js", { type: "module" });

  return true;
}

/**
 * Turn the offline shell on as the page loads, and say so if it will not.
 *
 * Nothing awaits this: it is the last statement of a module the page loads and
 * nobody holds. A registration the browser refuses - a worker that will not
 * parse, a MIME type it will not take, a scope it will not grant, storage the
 * reader has blocked - would otherwise reject into the console, and the reader
 * would go on believing they had an app that starts without a network when they
 * do not.
 *
 * @param {Document} page the document
 * @param {Navigator} agent the browser
 * @param {CacheStorage} store the browser's caches
 * @param {(message: string, tone: string) => void} report how to tell the reader
 * @returns {Promise<void>} when it is on, or has said why it is not
 */
export async function start(page, agent, store, report) {
  try {
    await offline(page, agent, store);
  } catch (failure) {
    report(failure.message, "error");
  }
}

// The browser is passed in rather than reached for, so a test can hand these
// functions a document and a navigator of its own. In node there is a navigator
// with no workers on it, which is the answer this wants anyway.
start(globalThis.document, globalThis.navigator, globalThis.caches, say);
