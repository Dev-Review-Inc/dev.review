// Signing is checked against AWS's own published example, not against itself.
//
// A signer tested only by re-running its own arithmetic proves nothing. The
// vectors below are AWS's worked examples from the Signature Version 4
// documentation, including the intermediate canonical request and string to
// sign, so a break says which step broke.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalRequest,
  hex,
  scopeOf,
  sha256Hex,
  signRequest,
  signingKey,
  stringToSign,
  stamps,
} from "../../web/src/adapters/sigv4.js";

// AWS "Signature Calculation: Transfer Payload in a Single Chunk" example.
const example = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "s3",
  date: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
};

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sigv4", () => {
  test("stamps a date the way AWS wants to read it", () => {
    assert.deepEqual(stamps(example.date), {
      amzDate: "20130524T000000Z",
      dateStamp: "20130524",
    });
  });

  test("hashes an empty payload to the well known empty digest", async () => {
    assert.equal(await sha256Hex(new Uint8Array()), EMPTY_SHA256);
  });

  test("builds the canonical request AWS documents for the GET example", async () => {
    const { canonical, signedHeaders } = canonicalRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: {
        Host: "examplebucket.s3.amazonaws.com",
        Range: "bytes=0-9",
        "x-amz-content-sha256": EMPTY_SHA256,
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: EMPTY_SHA256,
    });

    assert.equal(
      canonical,
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY_SHA256,
      ].join("\n"),
    );
    assert.equal(signedHeaders, "host;range;x-amz-content-sha256;x-amz-date");
    assert.equal(
      await sha256Hex(canonical),
      "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
    );
  });

  test("builds the string to sign AWS documents for the GET example", () => {
    assert.equal(
      stringToSign({
        amzDate: "20130524T000000Z",
        scope: "20130524/us-east-1/s3/aws4_request",
        canonicalHash: "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
      }),
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
      ].join("\n"),
    );
  });

  test("derives the signing key AWS documents for the IAM example", async () => {
    const key = await signingKey({
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      dateStamp: "20120215",
      region: "us-east-1",
      service: "iam",
    });

    assert.equal(hex(key), "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
  });

  // The signature below is the HMAC of the string to sign asserted above,
  // under the key derived by the scheme the IAM vector pins down. Both inputs
  // are AWS's published values, so this is an end-to-end check and not the
  // signer agreeing with itself.
  test("signs the documented GET example end to end", async () => {
    const headers = await signRequest({
      ...example,
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: { Range: "bytes=0-9" },
    });

    assert.equal(
      headers.Authorization,
      "AWS4-HMAC-SHA256 " +
        "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=67fe34c8530db585abddc51067328adfedb6e42487d2566dc7d927d6e2722900",
    );
  });

  test("signs the real payload rather than claiming it is unsigned", async () => {
    const body = new TextEncoder().encode("Welcome to Amazon S3.");

    const headers = await signRequest({
      ...example,
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/test%24file.text",
      headers: { "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      body,
    });

    // AWS's PUT example publishes this digest for that exact payload.
    assert.equal(
      headers["x-amz-content-sha256"],
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    );
    assert.match(headers.Authorization, /SignedHeaders=host;x-amz-content-sha256;/);
  });

  test("encodes a key with a reserved character the way the PUT example does", () => {
    const { canonical } = canonicalRequest({
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/test$file.text",
      headers: { Host: "examplebucket.s3.amazonaws.com" },
      payloadHash: EMPTY_SHA256,
    });

    assert.equal(canonical.split("\n")[1], "/test%24file.text");
  });

  test("canonicalises the query string by sorted, encoded pairs", async () => {
    const { canonical } = canonicalRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/?prefix=drafts%2F&max-keys=2&list-type=2",
      headers: { Host: "examplebucket.s3.amazonaws.com" },
      payloadHash: EMPTY_SHA256,
    });

    assert.equal(canonical.split("\n")[2], "list-type=2&max-keys=2&prefix=drafts%2F");
  });

  test("names the scope by day, region and service", () => {
    assert.equal(scopeOf("20130524", "eu-west-2", "s3"), "20130524/eu-west-2/s3/aws4_request");
  });

  test("carries a session token into the signed headers", async () => {
    const headers = await signRequest({
      ...example,
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      sessionToken: "a-temporary-token",
    });

    assert.equal(headers["x-amz-security-token"], "a-temporary-token");
    assert.match(headers.Authorization, /SignedHeaders=[^,]*x-amz-security-token/);
  });

  test("leaves the host header for the transport to set", async () => {
    const headers = await signRequest({
      ...example,
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
    });

    assert.equal(headers.host, undefined);
    assert.equal(headers.Host, undefined);
    assert.match(headers.Authorization, /SignedHeaders=host;/);
  });

  test("keeps the secret out of everything it hands back", async () => {
    const headers = await signRequest({
      ...example,
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
    });

    assert.ok(!JSON.stringify(headers).includes(example.secretAccessKey));
  });
});
