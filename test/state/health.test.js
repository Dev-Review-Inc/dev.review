import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { probe } from "../../web/src/state/health.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { DemoAdapter } from "../../web/src/adapters/demo.js";
import { aDraft } from "../use-cases/helper.js";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));

async function withDrafts(...numbers) {
  const adapter = new MemoryAdapter();

  for (const number of numbers) {
    await adapter.write(`drafts/org--app-${number}/review.json`, bytes(aDraft({ number })));
  }

  return adapter;
}

describe("Probing a source", () => {
  test("is ok when the source is readable and holds drafts", async () => {
    const health = await probe(await withDrafts(1), () => 1700);

    assert.deepEqual(health, { state: "ok", reason: "", drafts: 1, at: 1700 });
  });

  test("counts every draft, not every file", async () => {
    const adapter = await withDrafts(1, 2, 3);

    await adapter.write("drafts/org--app-1/qa.webm", bytes("not a draft"));
    await adapter.write("events/device-a.jsonl", bytes("not a draft"));

    assert.equal((await probe(adapter)).drafts, 3);
  });

  test("warns when the source is readable and holds no drafts", async () => {
    const health = await probe(new MemoryAdapter(), () => 1700);

    assert.equal(health.state, "warn");
    assert.equal(health.drafts, 0);
    assert.match(health.reason, /no drafts/i);
    assert.match(health.reason, /sweep/i);
  });

  test("is broken when the source says it is not ready, and says why", async () => {
    const adapter = new DemoAdapter({ seed: "/nowhere.json", fetch: async () => ({ ok: false }) });

    const health = await probe(adapter, () => 1700);

    assert.equal(health.state, "broken");
    assert.equal(health.drafts, 0);
    assert.ok(health.reason);
  });

  test("is broken when the source throws rather than answers", async () => {
    const adapter = {
      async ready() {
        return { ok: true, reason: "" };
      },
      async list() {
        throw new Error("the bucket is in eu-west-1, not us-east-1");
      },
    };

    const health = await probe(adapter, () => 1700);

    assert.deepEqual(health, {
      state: "broken",
      reason: "the bucket is in eu-west-1, not us-east-1",
      drafts: 0,
      at: 1700,
    });
  });

  test("stamps the time the probe finished", async () => {
    assert.equal((await probe(new MemoryAdapter(), () => 1700)).at, 1700);
  });
});
