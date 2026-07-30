// The offline shell: when it is turned on, and what it is allowed to touch.
//
// Two rules are pinned here because breaking either is silent. A worker must
// not run under the development server, which serves everything no-store so an
// edit shows on reload; a worker that answered from a cache there would make a
// saved file look like a file that had not been saved. And a worker must never
// touch a request that is not this origin's, because those are the reader's own
// bucket and api.github.com, carrying their token.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { developing, offline } from "../../web/src/app/offline.js";

// The worker registers its listeners on `self` as it is imported, so there has
// to be one before the import runs. Nothing else about a worker is needed: the
// part under test is a plain function over a Request.
globalThis.self = { addEventListener() {}, location: { origin: "https://dev.review" } };

const { ours } = await import("../../web/sw.js");

const ORIGIN = "https://dev.review";

// The smallest document these functions look at: one query, for the tag the
// development server appends to index.html.
function pageServed({ byTheDevelopmentServer }) {
  return {
    querySelector: (selector) =>
      selector === 'script[src="/reload.js"]' && byTheDevelopmentServer ? {} : null,
  };
}

function fakeAgent(alreadyRegistered = []) {
  const registered = [];
  const unregistered = [];

  return {
    registered,
    unregistered,
    serviceWorker: {
      register(url, options) {
        registered.push({ url, options });

        return Promise.resolve({});
      },
      getRegistrations() {
        return Promise.resolve(
          alreadyRegistered.map((name) => ({
            unregister: () => {
              unregistered.push(name);

              return Promise.resolve(true);
            },
          })),
        );
      },
    },
  };
}

function fakeStore(names = []) {
  const emptied = [];

  return {
    emptied,
    keys: () => Promise.resolve(names),
    delete: (name) => {
      emptied.push(name);

      return Promise.resolve(true);
    },
  };
}

describe("knowing which server is behind the page", () => {
  test("reads it off the reload listener the development server appends", () => {
    assert.equal(developing(pageServed({ byTheDevelopmentServer: true })), true);
    assert.equal(developing(pageServed({ byTheDevelopmentServer: false })), false);
  });
});

describe("turning the offline shell on", () => {
  // Beside the document rather than at the root. The interface is not promised
  // the root: the site can serve it under a subpath, and a worker asked for at
  // "/sw.js" from there would claim a scope the app does not own, which the
  // browser refuses. Relative, its scope is the tree the document came from,
  // which is every route the app has wherever it is mounted.
  test("registers the worker beside the document, whatever it is mounted under", async () => {
    const agent = fakeAgent();

    assert.equal(await offline(pageServed({ byTheDevelopmentServer: false }), agent, fakeStore()), true);
    assert.equal(agent.registered[0].url, "./sw.js");
  });

  test("registers nothing under the development server", async () => {
    const agent = fakeAgent();

    assert.equal(await offline(pageServed({ byTheDevelopmentServer: true }), agent, fakeStore()), false);
    assert.deepEqual(agent.registered, []);
  });

  // A reader who ran the shipped server on this port yesterday still has its
  // worker and its cache. Left alone, they would go on answering while the
  // reload listener reloaded a page that never changed.
  test("takes out a worker and a cache left over from the shipped server", async () => {
    const agent = fakeAgent(["an old worker"]);
    const store = fakeStore(["shell-1"]);

    await offline(pageServed({ byTheDevelopmentServer: true }), agent, store);

    assert.deepEqual(agent.unregistered, ["an old worker"]);
    assert.deepEqual(store.emptied, ["shell-1"]);
  });

  test("does nothing in a browser that has no workers", async () => {
    assert.equal(await offline(pageServed({ byTheDevelopmentServer: false }), {}, undefined), false);
  });
});

describe("what the worker will answer", () => {
  test("answers for this origin's own files", () => {
    assert.equal(ours(new Request(`${ORIGIN}/src/app/view.js`), ORIGIN), true);
    assert.equal(ours(new Request(`${ORIGIN}/review/org/app/42`), ORIGIN), true);
  });

  test("leaves GitHub and the reader's own storage alone", () => {
    assert.equal(ours(new Request("https://api.github.com/user"), ORIGIN), false);
    assert.equal(ours(new Request("https://storage.example.com/reviews/a.json"), ORIGIN), false);
  });

  test("leaves anything that is not a plain read alone", () => {
    assert.equal(ours(new Request(`${ORIGIN}/anything`, { method: "POST" }), ORIGIN), false);
  });

  test("leaves the development reload stream alone, which never ends", () => {
    assert.equal(ours(new Request(`${ORIGIN}/reload`), ORIGIN), false);
    assert.equal(ours(new Request(`${ORIGIN}/reload.js`), ORIGIN), false);
  });
});
