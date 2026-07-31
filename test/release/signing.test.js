// A signed release and an unsigned one are the same file until someone
// double-clicks it, and the person who finds out is the user, on the one day
// they were willing to try the app. Nothing in the build fails when signing
// quietly stops happening: tauri signs if the variables are there and ships a
// bare bundle if they are not, with the same exit code either way.
//
// So the workflow is read here as the artefact it is. These assert the wiring
// no other test would miss: that the secrets reach the build, that the
// notarisation key exists as a file by the time the build looks for it, and
// that the bundle is checked afterwards rather than assumed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");

// Every `secrets.APPLE_*` the file mentions, wherever it mentions it.
const used = [
  ...new Set([...workflow.matchAll(/secrets\.(APPLE_\w+)/g)].map((m) => m[1])),
];

// The preflight's own list, taken from the loop that walks it.
const checked = (workflow.match(/for name in ([A-Z0-9_ ]+); do/) ?? [, ""])[1]
  .split(/\s+/)
  .filter(Boolean);

describe("the signing a release depends on", () => {
  test("hands tauri the certificate to sign with", () => {
    for (const name of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
    ]) {
      assert.ok(used.includes(name), `the release workflow never reads ${name}`);
    }
  });

  test("hands tauri the credentials to notarise with", () => {
    // Without these the app is signed and still refused: Gatekeeper wants
    // Apple's countersignature, not ours.
    for (const name of ["APPLE_API_KEY", "APPLE_API_ISSUER"]) {
      assert.ok(used.includes(name), `the release workflow never reads ${name}`);
    }
  });

  test("writes the notarisation key out as a file to point at", () => {
    // APPLE_API_KEY_PATH is a path, not a key. The .p8 cannot live in a secret
    // and be read from one, so the secret holds it base64'd and a step lays it
    // down before the build goes looking.
    assert.match(workflow, /APPLE_API_KEY_PATH: \$\{\{ runner\.temp \}\}\/(\S+)/);

    const [, file] = workflow.match(/APPLE_API_KEY_PATH: \$\{\{ runner\.temp \}\}\/(\S+)/);

    assert.ok(
      workflow.includes(`base64 --decode > "$RUNNER_TEMP/${file}"`),
      `nothing in the release workflow writes ${file}`,
    );
  });

  test("names every secret it needs before it spends ten minutes", () => {
    // tauri branches on a variable being present, not on it being non-empty, so
    // a secret nobody set expands to "" and surfaces as an empty certificate at
    // the end of the build rather than as a missing secret at the start of it.
    for (const name of used) {
      assert.ok(
        checked.includes(name),
        `${name} reaches the build without the preflight checking it is set`,
      );
    }
  });

  test("checks the bundle it publishes is signed and stapled", () => {
    // The one assertion that survives tauri changing how it signs: ask macOS.
    assert.match(workflow, /codesign --verify/);
    assert.match(workflow, /stapler validate/);
  });

  test("notarises the file it uploads, not only the app inside it", () => {
    // tauri notarises and staples the .app and then wraps it in a disk image it
    // signs and never submits. The .app is not what anyone downloads: the .dmg
    // is, it arrives quarantined from a browser, and Gatekeeper assesses it on
    // mount. Verifying the .app alone passes while the download still warns.
    const published = workflow.slice(workflow.indexOf("Publish the installer"));

    assert.doesNotMatch(published, /notarytool submit/, "the dmg is notarised after being published");
    assert.match(workflow, /notarytool submit/);
    assert.match(workflow, /stapler staple/);

    // spctl reads the ticket off the file rather than trusting the submission,
    // and `--type open` is the assessment a mount performs.
    assert.match(workflow, /spctl --assess --type open/);
  });
});
