// The S3 adapter, proved interchangeable with the others.
//
// The point of the conformance suite is that a backend either behaves like
// every other backend or fails out loud, so this runs the whole suite against
// the real adapter with a fake S3 standing in for the network. The fake routes
// on method, path and query the way S3 does, pages its listings, and answers a
// missing key with a 404 - the three places an adapter usually diverges.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { itBehavesLikeAnAdapter } from "./conformance.js";
import { S3Adapter, parseListing } from "../../web/src/adapters/s3.js";

const BUCKET = "reviewer";
const ENDPOINT = "https://s3.example.test";

// Small enough that the conformance suite's three-file listings already cross a
// page boundary, so pagination is exercised by every run rather than by one
// test that remembers to.
const PAGE = 2;

const bytes = (text) => new TextEncoder().encode(text);

/**
 * A hash that changes when the content does, standing in for S3's MD5 ETag.
 *
 * @param {Uint8Array} content the object's bytes
 * @returns {string} a hex tag
 */
function tagOf(content) {
  let hash = 0x811c9dc5;

  for (const byte of content) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * An in-memory S3 that answers `fetch`.
 *
 * @returns {{fetch: Function, store: Map, calls: object[], reset: Function}} the fake
 */
function fakeS3() {
  const store = new Map();
  const calls = [];

  const error = (status, code) =>
    new Response(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`, {
      status,
      headers: { "content-type": "application/xml" },
    });

  const listing = (query) => {
    const prefix = query.get("prefix") || "";
    const after = query.get("continuation-token") || "";

    const keys = [...store.keys()]
      .sort()
      .filter((key) => key.startsWith(prefix) && key > after);

    const page = keys.slice(0, PAGE);
    const truncated = keys.length > page.length;

    const contents = page.map((key) => {
      const object = store.get(key);

      return [
        "<Contents>",
        `<Key>${escape(key)}</Key>`,
        `<LastModified>${new Date(object.modifiedAt).toISOString()}</LastModified>`,
        `<ETag>&quot;${object.etag}&quot;</ETag>`,
        `<Size>${object.bytes.length}</Size>`,
        "<StorageClass>STANDARD</StorageClass>",
        "</Contents>",
      ].join("");
    });

    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
      `<Name>${BUCKET}</Name>`,
      `<Prefix>${escape(prefix)}</Prefix>`,
      `<KeyCount>${page.length}</KeyCount>`,
      `<MaxKeys>${PAGE}</MaxKeys>`,
      `<IsTruncated>${truncated}</IsTruncated>`,
      truncated ? `<NextContinuationToken>${escape(page.at(-1))}</NextContinuationToken>` : "",
      ...contents,
      "</ListBucketResult>",
    ].join("");

    return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
  };

  return {
    store,
    calls,

    reset() {
      store.clear();
      calls.length = 0;
    },

    async fetch(url, init = {}) {
      const parsed = new URL(url);
      const method = (init.method || "GET").toUpperCase();
      const headers = init.headers || {};

      calls.push({ method, url: String(url), headers });

      const [bucket, ...rest] = parsed.pathname.slice(1).split("/");
      const key = rest.map((part) => decodeURIComponent(part)).join("/");

      if (bucket !== BUCKET) return error(404, "NoSuchBucket");
      if (!headers.Authorization) return error(403, "AccessDenied");

      if (method === "GET" && parsed.searchParams.get("list-type") === "2") {
        return listing(parsed.searchParams);
      }

      if (method === "PUT") {
        const body = new Uint8Array(init.body);
        const etag = tagOf(body);

        store.set(key, { bytes: body, etag, modifiedAt: Date.now() });

        return new Response(null, { status: 200, headers: { etag: `"${etag}"` } });
      }

      if (method === "GET" || method === "HEAD") {
        const object = store.get(key);

        if (!object) return error(404, "NoSuchKey");

        return new Response(method === "HEAD" ? null : object.bytes, {
          status: 200,
          headers: { etag: `"${object.etag}"`, "content-length": String(object.bytes.length) },
        });
      }

      if (method === "DELETE") {
        // S3 answers a delete of a key that was never there with a 204.
        store.delete(key);

        return new Response(null, { status: 204 });
      }

      return error(405, "MethodNotAllowed");
    },
  };
}

const s3 = fakeS3();

/**
 * @param {object} overrides anything to change about the standard config
 * @returns {S3Adapter} an adapter pointed at the fake
 */
function build(overrides = {}) {
  return new S3Adapter({
    label: "Test bucket",
    bucket: BUCKET,
    region: "us-east-1",
    endpoint: ENDPOINT,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    forcePathStyle: true,
    ...overrides,
  });
}

itBehavesLikeAnAdapter("s3", () => {
  s3.reset();
  globalThis.fetch = s3.fetch;

  return build();
});

describe("s3 adapter, in its own terms", () => {
  let adapter;

  beforeEach(() => {
    s3.reset();
    globalThis.fetch = s3.fetch;
    adapter = build();
  });

  test("follows the continuation token until the listing runs out", async () => {
    for (const index of [1, 2, 3, 4, 5]) {
      await adapter.write(`drafts/org--app-${index}/review.json`, bytes("{}"));
    }

    const listed = (await adapter.list("drafts/")).map((entry) => entry.path).sort();

    assert.equal(listed.length, 5);
    assert.equal(listed[0], "drafts/org--app-1/review.json");
    assert.ok(
      s3.calls.filter((call) => call.url.includes("continuation-token")).length >= 2,
      "the fake pages at two keys, so five keys must have taken more than one page",
    );
  });

  test("surfaces the entity tag without the quotes S3 wraps it in", async () => {
    await adapter.write("a.json", bytes("hello"));

    const [entry] = await adapter.list("");

    assert.equal(entry.etag, tagOf(bytes("hello")));
    assert.ok(!entry.etag.includes('"'));
  });

  test("writes under the configured prefix and lists without it", async () => {
    const prefixed = build({ prefix: "team/reviews" });

    await prefixed.write("drafts/a.json", bytes("{}"));

    assert.ok(s3.store.has("team/reviews/drafts/a.json"));
    assert.deepEqual(
      (await prefixed.list("drafts/")).map((entry) => entry.path),
      ["drafts/a.json"],
    );
    assert.deepEqual(await prefixed.read("drafts/a.json"), bytes("{}"));
  });

  test("keeps containment about the caller's path, not the prefixed key", async () => {
    const prefixed = build({ prefix: "team/reviews" });

    await assert.rejects(() => prefixed.read("../../etc/passwd"), /outside/);
  });

  test("reads a missing key as nothing", async () => {
    assert.equal(await adapter.read("drafts/nothing.json"), null);
  });

  test("refuses to pretend a server error is an empty file", async () => {
    globalThis.fetch = async () => new Response("<Error/>", { status: 500 });

    await assert.rejects(() => adapter.read("a.json"), /500/);
  });

  test("signs every request it makes", async () => {
    await adapter.write("a.json", bytes("{}"));
    await adapter.read("a.json");
    await adapter.list("");
    await adapter.remove("a.json");

    assert.ok(s3.calls.length >= 4);

    for (const call of s3.calls) {
      assert.match(call.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=/, call.url);
      assert.ok(call.headers["x-amz-content-sha256"], `${call.url} carries a payload hash`);
    }
  });

  test("never puts a credential in a url", async () => {
    await adapter.write("a.json", bytes("{}"));
    await adapter.list("");

    for (const call of s3.calls) {
      assert.ok(!call.url.includes("wJalrXUtnFEMI"), call.url);
      assert.ok(!call.url.includes("AKIAIOSFODNN7EXAMPLE"), call.url);
      assert.ok(!call.url.includes("Signature="), call.url);
    }
  });

  test("addresses the bucket as a host when path style is off", async () => {
    const virtual = build({ endpoint: "", region: "eu-west-2", forcePathStyle: false });

    globalThis.fetch = async (url) => {
      assert.equal(new URL(url).host, "reviewer.s3.eu-west-2.amazonaws.com");

      return new Response(null, { status: 404 });
    };

    await virtual.read("a.json");
  });

  test("says it is ready when the bucket answers", async () => {
    assert.deepEqual(await adapter.ready(), { ok: true, reason: "" });
  });

  test("blames the credentials when the bucket refuses them", async () => {
    globalThis.fetch = async () => new Response("<Error/>", { status: 403 });

    const { ok, reason } = await adapter.ready();

    assert.equal(ok, false);
    assert.match(reason, /access key/i);
  });

  test("blames the region when the bucket says it lives elsewhere", async () => {
    globalThis.fetch = async () =>
      new Response("<Error/>", { status: 301, headers: { "x-amz-bucket-region": "eu-west-2" } });

    const { ok, reason } = await adapter.ready();

    assert.equal(ok, false);
    assert.match(reason, /eu-west-2/);
  });

  test("blames the browser's rules when the request never left", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const { ok, reason } = await adapter.ready();

    assert.equal(ok, false);
    assert.match(reason, /CORS/);
  });

  test("keeps enough to be rebuilt, and no more than was given", () => {
    const config = build({ prefix: "team" }).config();

    assert.equal(config.type, "s3");
    assert.equal(config.bucket, BUCKET);
    assert.equal(config.prefix, "team");
    assert.equal(config.region, "us-east-1");
  });

  test("describes where it points", () => {
    assert.equal(build({ prefix: "team" }).describe(), "reviewer/team at s3.example.test");
  });
});

describe("the listing parser", () => {
  test("reads keys, sizes, times and tags out of a page", () => {
    const { entries, truncated, next } = parseListing(
      '<?xml version="1.0"?><ListBucketResult>' +
        "<IsTruncated>false</IsTruncated>" +
        "<Contents><Key>drafts/a.json</Key>" +
        "<LastModified>2026-07-30T10:00:00.000Z</LastModified>" +
        "<ETag>&quot;abc123&quot;</ETag><Size>42</Size></Contents>" +
        "</ListBucketResult>",
    );

    assert.equal(truncated, false);
    assert.equal(next, "");
    assert.deepEqual(entries, [
      {
        key: "drafts/a.json",
        size: 42,
        modifiedAt: Date.parse("2026-07-30T10:00:00.000Z"),
        etag: "abc123",
      },
    ]);
  });

  test("carries the continuation token off a truncated page", () => {
    const { truncated, next } = parseListing(
      "<ListBucketResult><IsTruncated>true</IsTruncated>" +
        "<NextContinuationToken>1/abc=</NextContinuationToken></ListBucketResult>",
    );

    assert.equal(truncated, true);
    assert.equal(next, "1/abc=");
  });

  test("puts escaped characters back the way they were written", () => {
    const { entries } = parseListing(
      "<ListBucketResult><Contents><Key>drafts/a &amp; b &lt;1&gt;.json</Key>" +
        "<Size>1</Size><LastModified>2026-07-30T10:00:00.000Z</LastModified>" +
        "</Contents></ListBucketResult>",
    );

    assert.equal(entries[0].key, "drafts/a & b <1>.json");
  });

  test("reads a page holding nothing as no entries rather than an error", () => {
    const { entries, truncated } = parseListing(
      "<ListBucketResult><Name>reviewer</Name><KeyCount>0</KeyCount></ListBucketResult>",
    );

    assert.deepEqual(entries, []);
    assert.equal(truncated, false);
  });
});

describe("when the browser will not make the request at all", () => {
  test("a bare fetch failure is explained as the CORS rules it almost always is", async () => {
    const adapter = new S3Adapter({
      bucket: "reviews",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await assert.rejects(() => adapter.list(""), /CORS/);
    await assert.rejects(() => adapter.read("a.json"), /CORS/);
    await assert.rejects(() => adapter.write("a.json", new Uint8Array([1])), /CORS/);
  });
});
