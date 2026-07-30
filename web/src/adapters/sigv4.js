// Signing requests to S3 without an SDK.
//
// The credentials are the customer's and never leave their browser, so the
// signing has to happen in the browser too. Pulling in the AWS SDK for the one
// algorithm it would be used for costs more than the algorithm does: this is
// about two hundred lines of WebCrypto, which every target runtime already has.
//
// Signatures go in headers, never in a query string. A presigned URL is a
// bearer token that ends up in logs, history and referrers; a signed header
// dies with the request.

const encoder = new TextEncoder();

const ALGORITHM = "AWS4-HMAC-SHA256";

/**
 * Bytes as lowercase hex, which is the only form AWS reads.
 *
 * @param {Uint8Array} bytes the bytes
 * @returns {string} the hex
 */
export function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The two date forms a signature needs.
 *
 * @param {Date} date the moment to sign at
 * @returns {{amzDate: string, dateStamp: string}} the timestamp and the day
 */
export function stamps(date) {
  const amzDate = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * @param {Uint8Array|string} value what to hash
 * @returns {Promise<string>} the SHA-256, hex encoded
 */
export async function sha256Hex(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return hex(new Uint8Array(digest));
}

/**
 * @param {Uint8Array} key the key
 * @param {Uint8Array|string} value what to sign
 * @returns {Promise<Uint8Array>} the HMAC-SHA256
 */
async function hmac(key, value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;

  const imported = await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", imported, bytes));
}

/**
 * Percent-encode one path segment or query component the way AWS does.
 *
 * `encodeURIComponent` leaves a handful of characters alone that RFC 3986 calls
 * reserved, and a signature that disagrees with the server about even one of
 * them fails with a message that names none of this.
 *
 * @param {string} value the raw value
 * @returns {string} the encoded value
 */
export function encodeComponent(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The canonical URI: the path, encoded once.
 *
 * S3 is the exception to AWS's usual double-encoding, because a key may contain
 * a literal slash-looking sequence that must survive as written.
 *
 * @param {string} pathname the URL's path
 * @returns {string} the canonical path
 */
function canonicalPath(pathname) {
  if (!pathname || pathname === "/") return "/";

  return pathname
    .split("/")
    .map((segment) => encodeComponent(decodeURIComponent(segment)))
    .join("/");
}

/**
 * The canonical query: every pair encoded, then sorted as encoded text.
 *
 * @param {URLSearchParams} params the query
 * @returns {string} the canonical query string
 */
function canonicalQuery(params) {
  return [...params]
    .map(([key, value]) => [encodeComponent(key), encodeComponent(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/**
 * The credential scope a signature is valid within.
 *
 * @param {string} dateStamp the day, as YYYYMMDD
 * @param {string} region the region
 * @param {string} service the service
 * @returns {string} the scope
 */
export function scopeOf(dateStamp, region, service) {
  return `${dateStamp}/${region}/${service}/aws4_request`;
}

/**
 * The canonical request: the request rewritten so both ends agree what it says.
 *
 * @param {{method: string, url: string, headers: object, payloadHash: string}} request the request
 * @returns {{canonical: string, signedHeaders: string}} the canonical form and the headers it covers
 */
export function canonicalRequest({ method, url, headers, payloadHash }) {
  const parsed = new URL(url);

  const named = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, " ")])
    .sort(([left], [right]) => left.localeCompare(right));

  const signedHeaders = named.map(([name]) => name).join(";");

  const canonical = [
    method.toUpperCase(),
    canonicalPath(parsed.pathname),
    canonicalQuery(parsed.searchParams),
    ...named.map(([name, value]) => `${name}:${value}`),
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");

  return { canonical, signedHeaders };
}

/**
 * The string the signature is actually taken over.
 *
 * @param {{amzDate: string, scope: string, canonicalHash: string}} parts the pieces
 * @returns {string} the string to sign
 */
export function stringToSign({ amzDate, scope, canonicalHash }) {
  return [ALGORITHM, amzDate, scope, canonicalHash].join("\n");
}

/**
 * The key for one day, one region and one service.
 *
 * Derived rather than used directly, so a leaked signature reveals nothing that
 * works tomorrow or anywhere else.
 *
 * @param {{secretAccessKey: string, dateStamp: string, region: string, service: string}} parts the pieces
 * @returns {Promise<Uint8Array>} the signing key
 */
export async function signingKey({ secretAccessKey, dateStamp, region, service }) {
  const dated = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const regional = await hmac(dated, region);
  const serviced = await hmac(regional, service);

  return hmac(serviced, "aws4_request");
}

/**
 * Sign a request, and say what to send.
 *
 * The `host` header is signed but not returned: a browser sets it itself and
 * refuses to be told, and what it sets is what was signed.
 *
 * The payload is hashed for real. UNSIGNED-PAYLOAD would save a pass over the
 * bytes, and would also mean a proxy could swap a QA video for something else
 * without the signature noticing.
 *
 * @param {object} request what to sign
 * @param {string} request.method the HTTP method
 * @param {string} request.url the full URL, query included
 * @param {object} [request.headers] headers to send and sign
 * @param {Uint8Array} [request.body] the request body
 * @param {string} request.region the region
 * @param {string} request.service the service, "s3" here
 * @param {string} request.accessKeyId the access key
 * @param {string} request.secretAccessKey the secret
 * @param {string} [request.sessionToken] a temporary credential's token
 * @param {Date} [request.date] the moment to sign at
 * @returns {Promise<object>} the headers to send, Authorization included
 */
export async function signRequest({
  method,
  url,
  headers = {},
  body,
  region,
  service,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  date = new Date(),
}) {
  const { amzDate, dateStamp } = stamps(date);
  const payloadHash = await sha256Hex(body ?? new Uint8Array());

  const sent = {
    ...headers,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
  };

  const { canonical, signedHeaders } = canonicalRequest({
    method,
    url,
    headers: { ...sent, host: new URL(url).host },
    payloadHash,
  });

  const scope = scopeOf(dateStamp, region, service);

  const signature = hex(
    await hmac(
      await signingKey({ secretAccessKey, dateStamp, region, service }),
      stringToSign({ amzDate, scope, canonicalHash: await sha256Hex(canonical) }),
    ),
  );

  return {
    ...sent,
    Authorization:
      `${ALGORITHM} Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
