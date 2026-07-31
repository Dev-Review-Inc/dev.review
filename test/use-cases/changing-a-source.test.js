import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { App } from "../../web/src/app/app.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { adapterTypes } from "../../web/src/adapters/index.js";
import { agentWrites, aDraft, aPull } from "./helper.js";

function someDatabases() {
  const made = new Map();

  return (name) => {
    if (!made.has(name)) made.set(name, new MemoryKeyValueStore());

    return made.get(name);
  };
}

function aDestination() {
  return {
    identify: async () => ({ login: "reader" }),
    queue: async () => [aPull()],
    files: async () => [],
    headCommit: async () => "e612b1b",
    comment: async () => ({ url: "https://github.com/comment/1" }),
    review: async () => ({ url: "https://github.com/review/1" }),
  };
}

describe("Choosing where drafts come from", () => {
  test("a store that keeps nothing is not offered as somewhere to keep things", () => {
    const offered = adapterTypes().map((entry) => entry.type);

    assert.equal(offered.includes("memory"), false);
  });

  test("the native reader is listed but unusable outside the desktop build", () => {
    const tauri = adapterTypes().find((entry) => entry.type === "tauri");

    assert.ok(tauri, "dropping it would leave the reader nothing to look at");
    assert.match(tauri.reason, /desktop app/i);
  });

  test("each backend says what it needs asking for, so no form knows a backend", () => {
    const [s3] = adapterTypes().filter((entry) => entry.type === "s3");

    assert.ok(Array.isArray(s3.fields));
    assert.deepEqual(
      s3.fields.filter((field) => field.secret).map((field) => field.key).sort(),
      ["accessKeyId", "secretAccessKey"],
    );
    assert.ok(s3.fields.find((field) => field.key === "bucket").required);
  });
});

describe("Fixing a source that was set up wrong", () => {
  let app;
  let adapter;
  let source;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    app = new App({
      database: someDatabases(),
      adapter: () => adapter,
      destination: () => aDestination(),
    });
    await app.boot();
    await agentWrites(adapter, aDraft());
    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
    source = await app.addSource({
      name: "Wrok",
      adapter: { type: "s3", bucket: "typo", region: "us-east-1" },
      secret: { accessKeyId: "AK", secretAccessKey: "SK" },
    });
    await app.select(app.queue()[0]);
    const [finding] = app.queries.findingsForPull(app.source, app.selected);
    app.commands.dropFinding(app.source, app.selected, finding);
  });

  test("renaming it keeps everything recorded against it", async () => {
    await app.editSource(source, { name: "Work" });

    assert.equal(app.queries.findSource(source.id).name, "Work");
    assert.ok(app.queries.findingsForPull(app.source, app.selected)[0].droppedAt);
  });

  test("correcting the bucket keeps the same source, and its decisions", async () => {
    await app.editSource(source, {
      adapter: { type: "s3", bucket: "correct", region: "us-east-1" },
    });

    const after = app.queries.findSource(source.id);
    assert.equal(after.id, source.id);
    assert.equal(after.adapter.bucket, "correct");
    assert.ok(app.queries.findingsForPull(app.source, app.selected)[0].droppedAt);
  });

  test("a key left blank is left alone rather than blanked", async () => {
    await app.editSource(source, {
      adapter: { type: "s3", bucket: "correct", region: "us-east-1" },
      secret: { accessKeyId: "AK2", secretAccessKey: "" },
    });

    const secret = await app.state.secret(source.id);
    assert.equal(secret.accessKeyId, "AK2");
    assert.equal(secret.secretAccessKey, "SK");
  });

  test("which secrets are set can be shown without handing them back", async () => {
    const set = await app.secretsSetFor(source);

    assert.deepEqual(set, { accessKeyId: true, secretAccessKey: true });
  });

  test("an edit that would break the source is refused, and changes nothing", async () => {
    const broken = new App({
      database: someDatabases(),
      adapter: () => ({
        ready: async () => ({ ok: false, reason: "that bucket refused the connection" }),
        config: () => ({ type: "s3" }),
        list: async () => [],
        read: async () => null,
        watch: () => () => {},
      }),
      destination: () => aDestination(),
    });
    await broken.boot();
    const attached = await broken.addSource({ name: "Bucket", adapter: { type: "s3" } });

    await assert.rejects(
      () => broken.editSource(attached, { adapter: { type: "s3", bucket: "nope" } }),
      /refused the connection/,
    );

    assert.equal(broken.queries.findSource(attached.id).adapter.bucket, undefined);
  });
});

describe("Fixing a destination", () => {
  let app;
  let destination;

  beforeEach(async () => {
    app = new App({
      database: someDatabases(),
      adapter: () => new MemoryAdapter(),
      destination: () => aDestination(),
    });
    await app.boot();
    destination = await app.addDestination({
      type: "github",
      label: "GitHub",
      secret: { token: "old-token" },
    });
  });

  test("a rotated token replaces the old one", async () => {
    await app.editDestination(destination, { secret: { token: "new-token" } });

    assert.equal((await app.state.secret(destination.id)).token, "new-token");
  });

  test("renaming it leaves the token alone", async () => {
    await app.editDestination(destination, { label: "Work GitHub" });

    assert.equal(app.queries.findDestination(destination.id).label, "Work GitHub");
    assert.equal((await app.state.secret(destination.id)).token, "old-token");
  });

  test("a token that the destination rejects is refused, and the old one stands", async () => {
    const app2 = new App({
      database: someDatabases(),
      adapter: () => new MemoryAdapter(),
      destination: (_, secret) => ({
        identify: async () => {
          if (secret.token === "bad") throw new Error("Bad credentials");

          return { login: "reader" };
        },
        queue: async () => [],
      }),
    });
    await app2.boot();
    const added = await app2.addDestination({
      type: "github",
      label: "GitHub",
      secret: { token: "good" },
    });

    await assert.rejects(
      () => app2.editDestination(added, { secret: { token: "bad" } }),
      /Bad credentials/,
    );

    assert.equal((await app2.state.secret(added.id)).token, "good");
  });
});

describe("Seeing how every source is doing", () => {
  let databases;
  let adapter;

  beforeEach(async () => {
    databases = someDatabases();
    adapter = new MemoryAdapter();
  });

  function anApp() {
    return new App({
      database: databases,
      adapter: () => adapter,
      destination: () => aDestination(),
    });
  }

  test("every configured source has been looked at once the app is up", async () => {
    const app = anApp();
    await app.boot();
    await agentWrites(adapter, aDraft());
    const work = await app.addSource({ name: "Work", adapter: { type: "memory" } });
    const spare = await app.addSource({ name: "Spare", adapter: { type: "memory" } });

    const reopened = anApp();
    await reopened.boot();

    assert.equal(reopened.health[work.id].state, "ok");
    assert.equal(reopened.health[work.id].drafts, 1);
    assert.equal(reopened.health[spare.id].state, "ok");
    assert.ok(reopened.healthOf(work).at > 0);
  });

  test("a source nobody has written to yet is a warning rather than a fault", async () => {
    const app = anApp();
    await app.boot();
    const source = await app.addSource({ name: "Work", adapter: { type: "memory" } });

    assert.equal(app.healthOf(source).state, "warn");
    assert.match(app.healthOf(source).reason, /sweep/i);
  });

  test("a source that cannot be reached is reported, and the rest still are", async () => {
    const app = new App({
      database: databases,
      adapter: (config) => {
        if (config.bucket) throw new Error("the bucket is gone");

        return adapter;
      },
      destination: () => aDestination(),
    });
    await app.boot();
    await agentWrites(adapter, aDraft());
    const work = await app.addSource({ name: "Work", adapter: { type: "memory" } });
    const gone = await app.addSource({
      name: "Gone",
      adapter: { type: "s3", bucket: "gone", region: "us-east-1" },
    });

    assert.equal(app.healthOf(gone).state, "broken");
    assert.match(app.healthOf(gone).reason, /bucket is gone/);
    assert.equal(app.healthOf(work).state, "ok");
  });

  test("a source that has been forgotten is no longer reported on", async () => {
    const app = anApp();
    await app.boot();
    const source = await app.addSource({ name: "Work", adapter: { type: "memory" } });

    await app.removeSource(source);

    assert.equal(app.healthOf(source), null);
  });

  // A git source keeps a whole clone of the customer's repository on this
  // machine. Removing the source without removing that would be a delete that
  // deleted nothing, and the copy left behind holds their source code.
  test("removing a source deletes the copy it was keeping on this machine", async () => {
    const app = anApp();
    await app.boot();
    const source = await app.addSource({ name: "Work", adapter: { type: "memory" } });
    let forgotten = 0;
    adapter.forget = async () => {
      forgotten += 1;
    };

    await app.removeSource(source);

    assert.equal(forgotten, 1);
  });

  test("a copy that cannot be deleted is not what stops a source being removed", async () => {
    const app = anApp();
    await app.boot();
    const source = await app.addSource({ name: "Work", adapter: { type: "memory" } });
    adapter.forget = async () => {
      throw new Error("the disk is read only");
    };

    await app.removeSource(source);

    assert.equal(app.healthOf(source), null);
    assert.deepEqual(app.queries.allSources(), []);
  });

  test("a source whose reader cannot even be built is still removed", async () => {
    const app = new App({
      database: databases,
      adapter: () => {
        throw new Error("this build cannot read from that storage");
      },
      destination: () => aDestination(),
    });
    await app.boot();
    const source = await app.commands.addSource({
      name: "Work",
      adapter: { type: "memory" },
    });

    await app.removeSource(source);

    assert.deepEqual(app.queries.allSources(), []);
  });
});
