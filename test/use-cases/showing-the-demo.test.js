// A visitor who arrived from a marketing page, with no token and no storage.
//
// The app they get is the app, wired the way a browser wires it: the real
// commands, the real adapters, the real destinations. Only the sample data is
// stubbed, because a static file over fetch is the one thing node has not got.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { App } from "../../web/src/app/app.js";
import { installDemo, demoWanted, resetDemo } from "../../web/src/app/demo.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { aDraft, aPull } from "./helper.js";

// Databases that outlive one App, so booting a second one against them is what
// a reload is.
function someDatabases() {
  const made = new Map();

  return (name) => {
    if (!made.has(name)) made.set(name, new MemoryKeyValueStore());

    return made.get(name);
  };
}

const draft = aDraft();
const pull = aPull();

const SEEDS = {
  tour: {
    drafts: { "drafts/org--app-42/review.json": draft },
  },
  real: { drafts: {} },
  queue: {
    login: "visitor",
    pulls: [pull],
    files: { "org/app#42": [{ filename: "lib/error.rb", status: "modified", patch: "@@" }] },
    commits: { "org/app#42": "e612b1b" },
  },
};

// The site, serving whatever is under its demo directory.
function siteServing(seeds) {
  return async (url) => {
    const name = String(url).split("/").pop().replace(".json", "");
    const document = seeds[name];

    if (!document) return { ok: false, status: 404 };

    return { ok: true, json: async () => document };
  };
}

describe("Which pages get the demo", () => {
  test("only the ones that asked for it", () => {
    assert.equal(demoWanted("?demo"), true);
    assert.equal(demoWanted("?demo=1&pull=3"), true);
    assert.equal(demoWanted(""), false);
    assert.equal(demoWanted("?pull=3"), false);
  });
});

describe("Arriving on a page that asked for the demo", () => {
  let was;

  beforeEach(() => {
    was = globalThis.fetch;
    globalThis.fetch = siteServing(SEEDS);
  });

  afterEach(() => {
    globalThis.fetch = was;
  });

  async function aVisit(database = someDatabases()) {
    const app = new App({ database, install: installDemo });

    await app.boot();

    return app;
  }

  test("attaches both sample sources and somewhere for them to post", async () => {
    const app = await aVisit();

    assert.deepEqual(
      app.queries.allSources().map((source) => source.name).sort(),
      ["A real review", "Take the tour"],
    );
    assert.equal(app.queries.allDestinations().length, 1);
  });

  test("opens on the tour, signed in, with the sample queue in front of the reader", async () => {
    const app = await aVisit();

    assert.equal(app.source.name, "Take the tour");
    assert.equal(app.login, "visitor");
    assert.equal(app.queue().length, 1);
    assert.equal(app.problem, "");
  });

  test("reads the sample draft, so the queue says a review is waiting", async () => {
    const app = await aVisit();

    assert.equal(app.queue()[0].isReady, true);
    assert.equal(app.drafts.find("org/app#42").verdict, "COMMENT");
  });

  test("brings the diff and the head commit with a pull request it opens", async () => {
    const app = await aVisit();

    await app.select(app.queue()[0]);

    assert.equal(app.files[0].filename, "lib/error.rb");
    assert.equal(app.headCommit, "e612b1b");
  });

  test("posts a review nowhere, while recording that the reader posted it", async () => {
    const app = await aVisit();
    await app.select(app.queue()[0]);

    const posted = await app.postReview({ body: "Sending this.", event: "COMMENT" });

    assert.equal(posted.url, pull.url);
    assert.equal(app.selected.postedAt !== undefined, true);
  });

  test("leaves what the reader did alone on the next visit", async () => {
    const databases = someDatabases();
    const first = await aVisit(databases);
    await first.select(first.queue()[0]);
    first.commands.dismissPull(first.source, first.selected);

    const again = await aVisit(databases);

    assert.equal(again.queries.allSources().length, 2, "the demo attaches itself once, not twice");
    assert.deepEqual(again.queue(), []);
  });

  // Decisions persist, which is the point of the demo and also its trap: a
  // visitor who triages everything is left with an empty marketing page, and so
  // is the next person to open that browser.
  test("starts clean again when the reader asks it to", async () => {
    const databases = someDatabases();
    const app = await aVisit(databases);
    await app.select(app.queue()[0]);
    app.commands.dismissPull(app.source, app.selected);

    assert.deepEqual(app.queue(), [], "nothing left to look at");

    await resetDemo(app);

    assert.equal(app.queue().length, 1, "the sample review is back as it was written");
    assert.equal(app.queries.allSources().length, 2, "and not doubled up");
    // Dropping the sources took their decision logs with them, so what is back
    // is the sample data rather than the sample data wearing a history.
    assert.equal(app.queue()[0].isReady, true);
  });

  test("refuses to reset a browser that reads real storage, whatever the page says", async () => {
    const databases = someDatabases();
    const app = new App({ database: databases });
    await app.boot();
    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    await resetDemo(app);

    assert.deepEqual(app.queries.allSources().map((source) => source.name), ["Work"]);
  });

  test("leaves a browser that already reads real storage alone", async () => {
    const databases = someDatabases();
    const app = new App({ database: databases });
    await app.boot();
    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    const again = await aVisit(databases);

    assert.deepEqual(again.queries.allSources().map((source) => source.name), ["Work"]);
  });
});

describe("A demo whose sample data was never deployed", () => {
  let was;

  beforeEach(() => {
    was = globalThis.fetch;
    globalThis.fetch = siteServing({});
  });

  afterEach(() => {
    globalThis.fetch = was;
  });

  test("says so where problems are shown, rather than failing to start", async () => {
    const app = new App({ database: someDatabases(), install: installDemo });

    await app.boot();

    assert.match(app.problem, /sample data/i);
    assert.deepEqual(app.queue(), []);
  });
});
