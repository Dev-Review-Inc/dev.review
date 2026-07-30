// The reader behind the demo.
//
// Two things are pinned here. Empty, it is an adapter like every other, so it
// runs the whole conformance suite unweakened. Seeded, it is sample data that
// is read only, with the reader's own writes laid over the top, and the seed
// has to survive whatever those writes do.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { itBehavesLikeAnAdapter } from "./conformance.js";
import { DemoAdapter } from "../../web/src/adapters/demo.js";

itBehavesLikeAnAdapter("demo", () => new DemoAdapter());

const text = (value) => new TextDecoder().decode(value);

const aSeed = () => ({
  drafts: {
    "drafts/org--app-1/review.json": { schema: 3, owner: "org", repo: "app", number: 1 },
  },
  media: { "qa/run.mp4": "data:video/mp4;base64,AAAA" },
});

// A page serving one static file, and a note of every time it was asked for.
function serving(document, asked = []) {
  return async (url) => {
    asked.push(url);

    return { ok: true, json: async () => document };
  };
}

describe("a demo adapter with sample data behind it", () => {
  test("reads a draft out of its seed", async () => {
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(aSeed()) });

    const bytes = await adapter.read("drafts/org--app-1/review.json");

    assert.equal(JSON.parse(text(bytes)).number, 1);
  });

  test("lists what the seed holds", async () => {
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(aSeed()) });

    const listed = (await adapter.list("drafts/")).map((entry) => entry.path);

    assert.deepEqual(listed, ["drafts/org--app-1/review.json"]);
  });

  test("asks for the seed once however often it is read", async () => {
    const asked = [];
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(aSeed(), asked) });

    await adapter.list("");
    await adapter.read("drafts/org--app-1/review.json");
    await adapter.list("drafts/");

    assert.deepEqual(asked, ["/demo/tour.json"]);
  });

  test("hands over seeded media as the url the seed gave, without any bytes", async () => {
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(aSeed()) });

    const media = await adapter.media("qa/run.mp4");

    assert.equal(media.url, "data:video/mp4;base64,AAAA");
    assert.doesNotThrow(() => media.release());
  });

  test("shadows the seed with a write rather than changing it", async () => {
    const document = aSeed();
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(document) });

    await adapter.write("drafts/org--app-1/review.json", new TextEncoder().encode('{"mine":true}'));

    assert.equal(text(await adapter.read("drafts/org--app-1/review.json")), '{"mine":true}');
    assert.equal(document.drafts["drafts/org--app-1/review.json"].number, 1);
  });

  test("reads a removed seed path as nothing, and stops listing it", async () => {
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(aSeed()) });

    await adapter.remove("drafts/org--app-1/review.json");

    assert.equal(await adapter.read("drafts/org--app-1/review.json"), null);
    assert.deepEqual(await adapter.list("drafts/"), []);
  });

  test("leaves the sample data intact for the next adapter reading it", async () => {
    const document = aSeed();
    const first = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(document) });
    const second = new DemoAdapter({ seed: "/demo/tour.json", fetch: serving(document) });

    await first.write("drafts/org--app-1/review.json", new TextEncoder().encode("{}"));
    await first.remove("qa/run.mp4");

    assert.equal(JSON.parse(text(await second.read("drafts/org--app-1/review.json"))).number, 1);
    assert.equal((await second.media("qa/run.mp4")).url, "data:video/mp4;base64,AAAA");
  });

  test("keeps its seed in its configuration, so it can be rebuilt", () => {
    const adapter = new DemoAdapter({ label: "Tour", seed: "/demo/tour.json" });

    assert.deepEqual(adapter.config(), { type: "demo", label: "Tour", seed: "/demo/tour.json" });
  });
});

describe("a demo adapter whose sample data was never deployed", () => {
  const missing = async () => ({ ok: false, status: 404 });
  const refused = async () => {
    throw new Error("Failed to fetch");
  };

  test("is empty rather than broken", async () => {
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: missing });

    assert.deepEqual(await adapter.list(""), []);
    assert.equal(await adapter.read("drafts/org--app-1/review.json"), null);
  });

  test("says what is wrong where the reader is shown problems", async () => {
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: missing });

    const ready = await adapter.ready();

    assert.equal(ready.ok, false);
    assert.match(ready.reason, /sample data/i);
  });

  test("survives a fetch that refuses outright", async () => {
    const adapter = new DemoAdapter({ seed: "/demo/tour.json", fetch: refused });

    assert.deepEqual(await adapter.list(""), []);
    assert.match((await adapter.ready()).reason, /sample data/i);
  });
});
