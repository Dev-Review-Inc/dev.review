import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { App } from "../../web/src/app/app.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { agentWrites, aDraft, aPull } from "./helper.js";

// Databases that outlive one App, so booting a second one against them is
// what a reload is: the same storage, a fresh application object.
function someDatabases() {
  const made = new Map();

  return (name) => {
    if (!made.has(name)) made.set(name, new MemoryKeyValueStore());

    return made.get(name);
  };
}

// One reader shared by every source in a test, so attaching the same
// storage twice is attaching the same storage.
function anAppOn(adapter, destination, database = someDatabases()) {
  return new App({ database, adapter: () => adapter, destination: () => destination });
}

function aForge(pulls = [aPull()]) {
  return {
    identify: async () => ({ login: "reader" }),
    queue: async () => pulls,
    files: async () => [],
    headCommit: async () => "e612b1b",
    comment: async () => ({ url: "https://github.com/comment/1" }),
    review: async () => ({ url: "https://github.com/review/1" }),
  };
}

describe("Setting up a source and a destination", () => {
  let app;
  let adapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    app = anAppOn(adapter, aForge());
    await app.boot();
  });

  test("a new install has nothing attached and says nothing is waiting", () => {
    assert.equal(app.source, null);
    assert.deepEqual(app.queue(), []);
  });

  test("attaching storage makes it the source being read", async () => {
    await agentWrites(adapter, aDraft());

    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    assert.equal(app.source.name, "Work");
    assert.equal(app.drafts.find("org/app#42").verdict, "COMMENT");
  });

  // The mistake this catches: a brand new repository or bucket with the
  // agent's files sitting at its root instead of nested under drafts/. With
  // no drafts/ at all, every read of every pull request answers "nothing
  // written yet", which is not what actually happened.
  test("attaching a source whose drafts sit at the root, not under drafts/, says so", async () => {
    await adapter.write(
      "org--app-42/review.json",
      new TextEncoder().encode(JSON.stringify(aDraft())),
    );

    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    assert.match(app.problem, /drafts\//);
  });

  test("adding a destination signs the reader in and fills the queue", async () => {
    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });

    assert.equal(app.login, "reader");
    assert.equal(app.queue().length, 1);
  });

  test("a token is kept beside the log, never in it", async () => {
    const destination = await app.addDestination({
      type: "github",
      label: "GitHub",
      secret: { token: "secret-token" },
    });

    const written = JSON.stringify(app.state.allEvents(null).map((event) => event.toLocal()));
    assert.equal(written.includes("secret-token"), false);
    assert.equal((await app.state.secret(destination.id)).token, "secret-token");
  });

  test("what was attached is still attached next time", async () => {
    const databases = someDatabases();
    const first = anAppOn(adapter, aForge(), databases);
    await first.boot();
    await first.addSource({ name: "Work", adapter: { type: "memory" } });
    await first.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });

    // The same databases, read again, as a reload would.
    const again = anAppOn(adapter, aForge(), databases);
    await again.boot();

    assert.equal(again.source.name, "Work");
    assert.equal(again.login, "reader");
  });

  test("a source whose storage cannot be reached still renders", async () => {
    const broken = new App({
      database: () => new MemoryKeyValueStore(),
      adapter: () => {
        throw new Error("that bucket refused the connection");
      },
      destination: () => aForge(),
    });
    await broken.boot();

    await broken.addSource({ name: "Bucket", adapter: { type: "s3" } });

    assert.match(broken.problem, /refused the connection/);
    assert.deepEqual(broken.queue(), []);
  });
});

describe("Working through the queue", () => {
  let app;
  let adapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    app = anAppOn(adapter, aForge());
    await app.boot();
    await agentWrites(adapter, aDraft());
    await app.addSource({ name: "Work", adapter: { type: "memory" } });
    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
  });

  test("opening a pull request brings its draft and its diff", async () => {
    await app.select(app.queue()[0]);

    assert.equal(app.selected.draft.title, "Re-root the errors onto a common base class");
    assert.equal(app.headCommit, "e612b1b");
  });

  test("posting the review records where it landed and clears the queue", async () => {
    await app.select(app.queue()[0]);

    await app.postReview({ body: "Sending this.", event: "COMMENT", commit_id: "e612b1b" });

    assert.equal(app.selected.postedUrl, "https://github.com/review/1");
    assert.deepEqual(app.queue(), []);
  });

  test("posting one finding leaves it out of the review that follows", async () => {
    await app.select(app.queue()[0]);
    const findings = app.queries.findingsForPull(app.source, app.selected);

    for (const finding of findings) app.commands.includeFinding(app.source, app.selected, finding);
    await app.postFinding(findings[0]);

    assert.deepEqual(
      app.queries.findingsToPost(app.source, app.selected).map((item) => item.id),
      ["spec-cannot-fail"],
    );
  });

  test("a filter clears when the same one is picked again", () => {
    app.show("summary", { section: "correctness" });
    assert.equal(app.filter.section, "correctness");

    app.show("summary", { section: "correctness" });

    assert.equal(app.filter.section, "");
  });

  test("the reader's decisions reach their storage without touching the draft", async () => {
    const before = await adapter.read("drafts/org--app-42/review.json");
    await app.select(app.queue()[0]);
    const [finding] = app.queries.findingsForPull(app.source, app.selected);

    app.commands.includeFinding(app.source, app.selected, finding);
    await app.commands.sync.push(app.source);

    const logs = await adapter.list(".reviewer/events/");
    assert.equal(logs.length, 1);
    assert.deepEqual(await adapter.read("drafts/org--app-42/review.json"), before);
  });
});

describe("When something is wrong", () => {
  test("a bad token is still reported after the source opens", async () => {
    const databases = someDatabases();
    const adapter = new MemoryAdapter();
    const app = new App({
      database: databases,
      adapter: () => adapter,
      destination: () => ({
        identify: async () => {
          throw new Error("Bad credentials");
        },
      }),
    });
    await app.boot();
    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "wrong" } });

    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    assert.match(app.problem, /Bad credentials/);
  });

  test("a source that opens cleanly clears its own earlier complaint", async () => {
    const adapter = new MemoryAdapter();
    const app = anAppOn(adapter, aForge());
    await app.boot();

    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    assert.equal(app.problem, "");
  });
});
