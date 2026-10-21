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

import { developing, offline, start } from "../../web/src/app/offline.js";

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

// Nothing awaits the call the module makes as the page loads. A registration
// the browser refuses - a worker that will not parse, a MIME type it will not
// take, storage the reader has blocked - would reject into the console, and the
// reader would go on believing they had an app that starts without a network.
describe("a registration the browser refuses", () => {
  function refusing(reason) {
    const agent = fakeAgent();

    agent.serviceWorker.register = () => Promise.reject(new Error(reason));

    return agent;
  }

  test("is said rather than dropped", async () => {
    const said = [];

    await start(
      pageServed({ byTheDevelopmentServer: false }),
      refusing("the worker would not parse"),
      fakeStore(),
      (message, tone) => said.push([message, tone]),
    );

    assert.deepEqual(said, [["the worker would not parse", "error"]]);
  });

  test("is held, so it is not the page's first unhandled rejection", async () => {
    const rejections = [];
    const note = (reason) => rejections.push(reason);

    process.on("unhandledRejection", note);

    start(pageServed({ byTheDevelopmentServer: false }), refusing("blocked"), fakeStore(), () => {});

    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", note);

    assert.deepEqual(rejections, []);
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

// node's Request reports an empty destination whatever it is asked for: the
// browser fills that in from the element that made the request, and there is no
// element here. The worker reads three fields off a request, so the cases that
// turn on what a request is for are made from those three.
function askedFor(url, { as = "", method = "GET" } = {}) {
  return { url, method, destination: as };
}

describe("what the worker will answer for an avatar", () => {
  test("answers the two origins a GitHub avatar comes from", () => {
    assert.equal(ours(askedFor("https://github.com/octocat.png?size=48", { as: "image" }), ORIGIN), true);
    assert.equal(ours(askedFor("https://avatars.githubusercontent.com/u/583231?v=4", { as: "image" }), ORIGIN), true);
  });

  test("answers those origins only for a picture", () => {
    assert.equal(ours(askedFor("https://github.com/org/app/pull/42", { as: "document" }), ORIGIN), false);
    assert.equal(ours(askedFor("https://github.com/octocat.png"), ORIGIN), false);
  });

  test("answers neither for anything but a plain read", () => {
    assert.equal(ours(askedFor("https://github.com/octocat.png", { as: "image", method: "POST" }), ORIGIN), false);
  });

  test("leaves the rest of GitHub and the reader's storage alone, picture or not", () => {
    assert.equal(ours(askedFor("https://api.github.com/user", { as: "image" }), ORIGIN), false);
    assert.equal(ours(askedFor("https://reviews.s3.amazonaws.com/a.png", { as: "image" }), ORIGIN), false);
    assert.equal(ours(askedFor("https://storage.example.com/reviews/a.png", { as: "image" }), ORIGIN), false);
  });

  // The origin is compared whole. A host that merely starts with or contains
  // github.com is a different site, and the one place a worker must not be
  // generous is deciding whose responses it is willing to hold.
  test("refuses an origin that only looks like GitHub's", () => {
    assert.equal(ours(askedFor("https://github.com.evil.test/octocat.png", { as: "image" }), ORIGIN), false);
    assert.equal(ours(askedFor("https://evil.test/https://github.com/octocat.png", { as: "image" }), ORIGIN), false);
    assert.equal(ours(askedFor("https://notgithub.com/octocat.png", { as: "image" }), ORIGIN), false);
    assert.equal(ours(askedFor("http://github.com/octocat.png", { as: "image" }), ORIGIN), false);
  });
});
