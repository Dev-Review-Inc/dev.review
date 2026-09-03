# Releasing

A release is a tag. Pushing `v0.2.0` runs [.github/workflows/release.yml](../.github/workflows/release.yml), which checks the tag against the version in `src-tauri/`, builds a universal macOS app, signs and notarises it, and publishes the `.dmg` to a GitHub release.

The version lives in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Both must already say `0.2.0` before the tag is pushed; the workflow refuses the tag otherwise, before it spends the build.

## Signing

macOS refuses to open an app it cannot trace to a developer Apple knows. Two separate things buy that trust and both are needed:

- **Signing** stamps the app with a Developer ID certificate that belongs to us.
- **Notarisation** sends the signed app to Apple, who scan it and countersign. A signed app that skipped this still shows the "cannot be opened" warning, because Gatekeeper is checking Apple's signature, not ours.

Tauri signs and notarises the `.app`, then wraps it in a disk image it signs and never submits. Nobody downloads the `.app`, so the workflow notarises and staples the `.dmg` itself as a second step: it arrives from a browser carrying a quarantine flag, and Gatekeeper assesses it on mount, before the stapled app inside is ever reached.

Both are then put to macOS with `codesign --verify`, `stapler validate` and `spctl --assess`. Those are the commands a user's Mac runs on mount and on first launch, run on the runner instead so a soft failure surfaces here rather than there.

All of it needs an [Apple Developer Program](https://developer.apple.com/programs/) membership. It costs $99 a year, and letting it lapse takes the certificate with it.

## The six secrets

Set these in the repository's Settings → Secrets and variables → Actions. The workflow names any that are unset and stops before building.

| Secret | What it holds |
| --- | --- |
| `APPLE_CERTIFICATE` | The Developer ID certificate, `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | The password set when exporting that `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_API_KEY` | The App Store Connect key ID, ten characters |
| `APPLE_API_ISSUER` | The issuer ID, a UUID |
| `APPLE_API_KEY_P8` | The `.p8` private key, base64 |

### The certificate

Done once on a Mac, on the keychain the certificate will live in.

1. **Make a signing request.** Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority. Enter the email and a common name, choose *Saved to disk*, and let it generate the key pair. This writes a `.certSigningRequest` and puts its private half in the login keychain. The certificate is worthless without that private half, so this is the step to do on a machine that gets backed up.

2. **Ask Apple for the certificate.** [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates) → +. Choose **Developer ID Application** — not Mac Development, and not Developer ID Installer, which signs `.pkg` files and cannot sign an app. Upload the request from step 1 and download the `.cer` it issues.

3. **Install it.** Double-click the `.cer`. Keychain Access now shows *Developer ID Application: Name (TEAMID)* with a private key nested under it. That full string, team ID and all, is `APPLE_SIGNING_IDENTITY`; `security find-identity -v -p codesigning` prints it exactly.

4. **Export it.** Right-click the certificate — the certificate, not the key — → Export → Personal Information Exchange (.p12). Set a password; it becomes `APPLE_CERTIFICATE_PASSWORD`. An export that produces a `.cer` rather than a `.p12` means the private key was not selected with it, and a certificate without its key cannot sign.

5. **Encode it.** A `.p12` is binary and a secret is text:

   ```bash
   base64 -i certificate.p12 | pbcopy
   ```

   Paste as `APPLE_CERTIFICATE`. Then delete the `.p12` and the `.cer` from disk; the keychain has the original and a copy in Downloads is a signing identity anyone with the laptop can use.

### The notarisation key

Notarisation authenticates separately, with an App Store Connect API key rather than an Apple ID. It is not tied to one person, survives password and 2FA changes, and does not expire on a schedule.

1. [appstoreconnect.apple.com/access/integrations/api](https://appstoreconnect.apple.com/access/integrations/api) → Team Keys → +. Name it for what uses it, and give it **Developer** access, which is the least that can notarise.

2. Download the `AuthKey_XXXXXXXXXX.p8`. **Once** — Apple will not offer it again, and a lost key is replaced rather than recovered.

3. From that same table: the **Key ID** is `APPLE_API_KEY`, and the **Issuer ID** above the table is `APPLE_API_ISSUER`.

4. Encode the key:

   ```bash
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

   Paste as `APPLE_API_KEY_P8`. The workflow writes it back out to a file during the build, because `notarytool` reads the key from disk and not from the environment.

## When a release fails

- **Stops immediately naming secrets.** They are unset, or set on the wrong repository. Nothing was built.
- **Fails in the build on the certificate.** The `.p12` did not carry its private key, or the password is wrong.
- **Fails on notarisation with a 403 naming an agreement.** Apple will not notarise for a team with an unsigned or expired Program License Agreement, however valid the key is. The Account Holder accepts it at [developer.apple.com/account](https://developer.apple.com/account), and it reappears whenever Apple revises the terms — so a release that has worked for a year can fail this way on a Tuesday, having changed nothing.
- **Fails on notarisation otherwise.** Usually the API key's access is below Developer, or the membership has lapsed. `xcrun notarytool log` against the submission ID in the run output gives Apple's own reason.
- **Builds, then fails `stapler validate`.** The app was signed but never notarised. This is the failure worth having: it is the one that used to reach users instead.

## The App Store build

This is a second, sandboxed macOS bundle for TestFlight and the App Store, alongside the `.dmg` above rather than instead of it. Nothing above changes for it: the `.dmg` still builds, signs and notarises exactly as it always has, from the same `tauri.conf.json`.

The App Store build lives in two extra files instead:

- `src-tauri/tauri.conf.appstore.json` — merged on top of `tauri.conf.json` with `--config`, not a fork of it. It narrows `bundle.targets` to `app` (no `.dmg`, no installer — the App Store does not take either) and points at the entitlements file below.
- `src-tauri/reviewer_macOS.entitlements` — App Sandbox, plus exactly the two entitlements the app still needs sandboxed: read-write on the folder the reader picked, and outgoing network. See the comment in that file for why nothing else is there.

Sandboxing costs the app its native git transport: App Sandbox forbids spawning a subprocess, so `git.rs` is compiled out under the `appstore` Cargo feature the same way it already is for iOS, and the frontend falls back to `git-isomorphic.js` automatically — see `git.rs`'s and `git.js`'s own comments. In its place, `bookmark.rs` keeps the chosen folder reachable across a relaunch with a security-scoped bookmark, which App Sandbox requires in place of a plain remembered path.

Build it locally with:

```bash
cd src-tauri
cargo tauri build --config tauri.conf.appstore.json --features appstore
```

This produces an unsigned (or ad-hoc-signed) `.app` under `target/*/release/bundle/macos/`, not a TestFlight build. What is still manual, because none of it can happen without an Apple Developer Program membership and a Distribution certificate that do not exist yet:

- Opening the generated Xcode project (or the `.app`) and selecting a signing team and a Distribution certificate — this mints the certificate itself on the first Archive if one does not already exist.
- Archiving and uploading through Xcode or `xcrun altool`/`notarytool` to App Store Connect.
- Confirming, by hand, that a folder picked before quitting the app is still reachable after relaunching it. A security-scoped bookmark that resolves in a unit test is not the same claim as one that survives an actual quit-and-reopen, and nothing in this repository can drive that check — it needs a person, once, before this ships.

There is no CI job for this build yet. Automating the sign-and-upload step is follow-up work for once the certificate exists.
