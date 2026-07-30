// A reader backed by an S3-compatible bucket.
//
// The bucket is the customer's: AWS S3, Cloudflare R2, MinIO on a box in the
// office. The credentials are theirs too, kept client side, sent as signed
// headers and never as a query string.
//
// Everything here is plain `fetch` against the REST API. No SDK, because the
// four verbs this adapter needs are four verbs, and an SDK would arrive with a
// credential chain that wants to read files and environment variables that do
// not exist in a browser.
//
// The listing comes back as XML. `DOMParser` exists in a browser and not in
// node, and the tests are the reason this adapter is trustworthy, so the
// listing is read by a small parser that runs in both.

import { Adapter, contain } from "./adapter.js";
import { encodeComponent, signRequest } from "./sigv4.js";

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/**
 * Undo the escaping S3 applies to text inside a tag.
 *
 * @param {string} text the escaped text
 * @returns {string} the text as written
 */
function unescape(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity]);
}

/**
 * The text of the first occurrence of a tag.
 *
 * @param {string} xml the document
 * @param {string} name the tag name
 * @returns {string} the text, unescaped, or "" if the tag is absent
 */
function tag(xml, name) {
  const found = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));

  return found ? unescape(found[1]) : "";
}

/**
 * Read one page of a ListObjectsV2 response.
 *
 * A general XML parser is not needed to read a document whose shape is fixed by
 * the API. What is needed is that it be tested, so it is exported.
 *
 * @param {string} xml the response body
 * @returns {{entries: {key: string, size: number, modifiedAt: number, etag: string}[], truncated: boolean, next: string}} the page
 */
export function parseListing(xml) {
  const entries = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, block]) => ({
    key: tag(block, "Key"),
    size: Number(tag(block, "Size")),
    modifiedAt: Date.parse(tag(block, "LastModified")),
    // The tag arrives wrapped in escaped quotes, which are punctuation rather
    // than part of the value. Callers compare tags; they should not have to
    // know that.
    etag: tag(block, "ETag").replace(/^"|"$/g, ""),
  }));

  const truncated = tag(xml, "IsTruncated") === "true";

  return { entries, truncated, next: truncated ? tag(xml, "NextContinuationToken") : "" };
}

export class S3Adapter extends Adapter {
  static type = "s3";
  static label = "S3 bucket";

  // What to ask for, declared here rather than in the interface, so no form
  // knows anything about a particular backend. Fields marked secret are kept
  // out of the event log and never rendered back into the page.
  static fields = [
    { key: "bucket", label: "bucket", mono: true, required: true },
    { key: "region", label: "region", mono: true, required: true, placeholder: "us-east-1" },
    {
      key: "endpoint",
      label: "endpoint",
      mono: true,
      placeholder: "https://s3.us-east-1.amazonaws.com",
    },
    { key: "prefix", label: "prefix", mono: true, placeholder: "reviews/" },
    { key: "accessKeyId", label: "access key id", mono: true, secret: true, required: true },
    {
      key: "secretAccessKey",
      label: "secret access key",
      mono: true,
      secret: true,
      required: true,
    },
  ];

  // S3 hands over an entity tag on every listed object, so two writes of the
  // same length in the same millisecond are still told apart.
  static precise = true;

  constructor(config = {}) {
    super();

    this._label = config.label || S3Adapter.label;
    this._bucket = config.bucket || "";
    this._region = config.region || "us-east-1";
    this._endpoint = config.endpoint || `https://s3.${this._region}.amazonaws.com`;
    this._prefix = String(config.prefix || "").replace(/^\/+|\/+$/g, "");
    this._accessKeyId = config.accessKeyId || "";
    this._secretAccessKey = config.secretAccessKey || "";
    this._sessionToken = config.sessionToken || "";

    // A custom endpoint is almost always MinIO or a self-hosted gateway, where
    // bucket-as-subdomain needs DNS nobody set up.
    this._forcePathStyle = config.forcePathStyle ?? Boolean(config.endpoint);
  }

  async list(prefix = "") {
    const under = this._key(contain(prefix));
    const entries = [];
    let token = "";

    // S3 answers at most a thousand keys at a time and says so. A source
    // with a year of drafts in it is several pages, and a listing that stopped
    // at the first would quietly report the rest as deleted.
    do {
      const query = { "list-type": "2", prefix: under };

      if (token) query["continuation-token"] = token;

      const response = await this._send({ method: "GET", query });

      if (!response.ok) throw this._failure(response, "list");

      const page = parseListing(await response.text());

      for (const entry of page.entries) {
        entries.push({
          path: this._path(entry.key),
          size: entry.size,
          modifiedAt: entry.modifiedAt,
          etag: entry.etag,
        });
      }

      token = page.next;
    } while (token);

    return entries;
  }

  async read(path) {
    const response = await this._send({ method: "GET", key: this._key(contain(path)) });

    // A path holding nothing is an answer, not a fault: the caller asked
    // whether there is a draft there, and there is not.
    if (response.status === 404) return null;
    if (!response.ok) throw this._failure(response, "read");

    return new Uint8Array(await response.arrayBuffer());
  }

  async write(path, bytes) {
    const response = await this._send({
      method: "PUT",
      key: this._key(contain(path)),
      body: Uint8Array.from(bytes),
    });

    if (!response.ok) throw this._failure(response, "write");
  }

  async remove(path) {
    const response = await this._send({ method: "DELETE", key: this._key(contain(path)) });

    // S3 answers 204 whether or not the key was there, and a gateway that
    // answers 404 instead means the same thing: it is gone now.
    if (!response.ok && response.status !== 404) throw this._failure(response, "remove");
  }

  async media(path) {
    const bytes = await this.read(path);

    if (!bytes) return null;

    // No URL.createObjectURL in node, and nothing to revoke there either.
    if (typeof URL.createObjectURL !== "function") {
      return { url: `s3:${this._key(contain(path))}`, release() {} };
    }

    const url = URL.createObjectURL(new Blob([bytes]));

    return { url, release: () => URL.revokeObjectURL(url) };
  }

  /**
   * Ask the bucket one cheap question, and translate its answer.
   *
   * The failures here are the four a customer actually hits, and each of them
   * arrives from the browser as something unhelpful. A wrong region is a 301
   * with no body; a CORS rule that does not name this origin is a `TypeError`
   * with no status at all.
   *
   * @returns {Promise<{ok: boolean, reason: string}>} whether the bucket can be used
   */
  async ready() {
    if (!this._bucket) return { ok: false, reason: "no bucket was named" };
    if (!this._accessKeyId || !this._secretAccessKey) {
      return { ok: false, reason: "no access key was given" };
    }

    let response;

    try {
      response = await this._send({
        method: "GET",
        query: { "list-type": "2", "max-keys": "1", prefix: this._prefix },
      });
    } catch (error) {
      // Already explained by _send, which is where every request funnels, so
      // there is one wording of this rather than two that can drift.
      return { ok: false, reason: error.message };
    }

    if (response.ok) return { ok: true, reason: "" };

    const elsewhere = response.headers.get("x-amz-bucket-region");

    if (elsewhere && elsewhere !== this._region) {
      return { ok: false, reason: `the bucket is in ${elsewhere}, not ${this._region}` };
    }

    if (response.status === 403) {
      return {
        ok: false,
        reason: `the access key was refused - check it can list and write ${this._bucket}`,
      };
    }

    if (response.status === 404) {
      return { ok: false, reason: `no bucket named ${this._bucket} at ${this._host()}` };
    }

    return { ok: false, reason: `${this._host()} answered ${response.status}` };
  }

  config() {
    return {
      type: S3Adapter.type,
      label: this._label,
      bucket: this._bucket,
      region: this._region,
      endpoint: this._endpoint,
      prefix: this._prefix,
      accessKeyId: this._accessKeyId,
      secretAccessKey: this._secretAccessKey,
      forcePathStyle: this._forcePathStyle,
    };
  }

  describe() {
    return `${[this._bucket, this._prefix].filter(Boolean).join("/")} at ${this._host()}`;
  }

  /**
   * The key a caller's path lives at.
   *
   * Containment is the caller's business and is checked before this, on the
   * path as given. The prefix is part of the adapter's root, so joining it on
   * afterwards cannot be what lets a path escape.
   *
   * @param {string} path a contained path
   * @returns {string} the object key
   */
  _key(path) {
    return this._prefix ? `${this._prefix}/${path}` : path;
  }

  /**
   * The path a key came from, with the adapter's prefix taken back off, so a
   * caller reads back the paths it wrote.
   *
   * @param {string} key the object key
   * @returns {string} the caller's path
   */
  _path(key) {
    return this._prefix && key.startsWith(`${this._prefix}/`)
      ? key.slice(this._prefix.length + 1)
      : key;
  }

  _host() {
    return new URL(this._endpoint).host;
  }

  /**
   * The URL for a key, addressed the way this endpoint expects.
   *
   * The query is built by hand rather than through `URLSearchParams`, which
   * writes a space as `+` where a signature says `%20`. A continuation token is
   * opaque base64 and a key may hold a space, so the two must agree.
   *
   * @param {string} key the object key, or "" for the bucket itself
   * @param {object} query query parameters
   * @returns {string} the full URL
   */
  _url(key, query) {
    const base = new URL(this._endpoint);
    const path = key
      ? `/${key.split("/").map(encodeComponent).join("/")}`
      : "";

    if (this._forcePathStyle) {
      base.pathname = `/${this._bucket}${path}`;
    } else {
      base.host = `${this._bucket}.${base.host}`;
      base.pathname = path || "/";
    }

    const pairs = Object.entries(query)
      .map(([name, value]) => `${encodeComponent(name)}=${encodeComponent(value)}`)
      .join("&");

    return pairs ? `${base.origin}${base.pathname}?${pairs}` : `${base.origin}${base.pathname}`;
  }

  /**
   * Sign one request and send it.
   *
   * @param {{method: string, key?: string, query?: object, body?: Uint8Array}} request what to send
   * @returns {Promise<Response>} whatever the bucket said
   */
  async _send({ method, key = "", query = {}, body }) {
    const url = this._url(key, query);

    const headers = await signRequest({
      method,
      url,
      body,
      region: this._region,
      service: "s3",
      accessKeyId: this._accessKeyId,
      secretAccessKey: this._secretAccessKey,
      sessionToken: this._sessionToken || undefined,
    });

    try {
      return await globalThis.fetch(url, { method, headers, body });
    } catch (error) {
      // A browser refusing a cross-origin request reports it as a bare
      // TypeError with no detail, on purpose: the response is not readable, so
      // there is nothing to report. It is almost always the bucket's CORS
      // rules, and a reader staring at "Failed to fetch" has no way to know
      // that, so say it here rather than making them find out.
      throw new Error(this._unreachable(error));
    }
  }

  /**
   * Why a request never got an answer.
   *
   * @param {Error} error whatever fetch threw
   * @returns {string} something a reader can act on
   */
  _unreachable(error) {
    if (!(error instanceof TypeError)) return error.message;

    return (
      `could not reach ${this._host()}: the browser refused the request before it was sent. ` +
      "The bucket's CORS rules must allow this origin for GET, PUT and DELETE, allow the " +
      "authorization and x-amz-* request headers, and expose etag and x-amz-bucket-region."
    );
  }

  /**
   * @param {Response} response what came back
   * @param {string} what the operation that failed
   * @returns {Error} an error naming the status, and never the credentials
   */
  _failure(response, what) {
    const error = new Error(`could not ${what} from ${this._bucket}: ${response.status}`);
    error.status = response.status;

    return error;
  }
}
