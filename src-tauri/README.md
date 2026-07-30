# The desktop shell

Tauri v2 wraps the same static frontend that is served in a browser, and adds
one thing the browser cannot offer everywhere: a folder on the local disk. The
File System Access API is Chromium-only, so a Safari or Firefox user has no
local reader at all. Inside this shell there is a real filesystem behind the IPC
boundary, and v2 targets iOS and Android from the same library entry point.

Tauri stops at the edge of the app. It is this directory, one adapter file
(`web/src/adapters/tauri.js`), and nothing else. The app code does not know the
desktop exists.

## Prerequisites

- Rust, stable, 1.88 or newer. Tauri itself asks for 1.77.2; its current
  dependency tree does not resolve below 1.88.
- macOS: Xcode command line tools.
- Windows: the Microsoft C++ build tools and WebView2 (WebView2 ships with
  Windows 11 and current Windows 10).
- The Tauri CLI, installed through Cargo rather than npm:

```
cargo install tauri-cli --version "^2" --locked
```

This project has no npm runtime or build dependencies and keeps it that way, so
`@tauri-apps/cli` and `@tauri-apps/api` are deliberately absent. The frontend
reaches Tauri through `globalThis.__TAURI__`, which `withGlobalTauri` puts
there.

## Running

```
cargo tauri dev      # from this directory
cargo tauri build    # produces the .app/.dmg or the .exe installer
```

There is no `beforeDevCommand` and no `beforeBuildCommand` because there is
nothing to build: `frontendDist` points at `../web`, which is already the
shipped artifact - `index.html` plus vanilla ES modules, no bundler. Editing a
file under `web/` and reloading the window is the whole development loop.

`icons/icon.png` is a plain placeholder, committed because `generate_context!`
refuses to compile without an icon. Replace it before shipping anything:
`cargo tauri icon path/to/icon.png` writes the full platform set, and the paths
it produces go in `bundle.icon` in `tauri.conf.json`.

## What the app is allowed to do

`capabilities/default.json` grants the main window four core permission sets and
nothing more:

- `core:app:default`, `core:event:default`, `core:window:default` and
  `core:webview:default` - what a window needs to exist, be told about its own
  lifecycle, and talk to the backend.

There is no `fs` permission, no `dialog` permission, no `shell` and no `http`.
That is not an oversight:

- A `#[tauri::command]` this app defines needs no permission. All filesystem
  access goes through five of them, each one taking the chosen root and a
  relative path, and each one refusing a path that resolves outside that root.
  Granting `fs` as well would hand the frontend a second, unaudited route to
  the same disk.
- The folder picker runs in Rust (`storage_pick_root`), so the frontend never
  calls the dialog plugin and needs no permission for it.

The CSP in `tauri.conf.json` matches the web deployment's intent: `script-src
'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`,
`img-src 'self' data: blob:` and `media-src 'self' blob:`. Three additions are
specific to the shell and would be meaningless on the web:

- `connect-src` carries `ipc:` and `http://ipc.localhost` alongside `'self'
  https:`, because that is how the webview reaches the Rust side on Windows and
  Linux. `https:` stays broad because the customer's own S3 endpoint is
  configured at runtime and is not knowable at build time.
- `img-src` and `media-src` carry `asset:` and `http://asset.localhost` so a QA
  video can stream off disk. `assetProtocol.scope` is empty in the config and
  widened at runtime to the one folder the user picked, which is the only point
  at which that folder is known.

## Path containment

`src/storage.rs` treats containment as a security boundary rather than
housekeeping. The paths it is given originate in draft files written by an agent
that reads other people's branches. `resolve` makes two passes: a textual one
that refuses absolute paths, `~`, Windows drive prefixes and `..` segments
(forward or backslashed), and a walking one that resolves every symlink it meets
and refuses any that lands outside the root. The second pass is the one a string
comparison would miss, including a *broken* link, which a naive existence check
would mistake for a path that does not exist yet and then write through.

Writes land as a rename over a temp file in the same directory. The agent
writing a draft and this app reading it are two processes looking at one folder,
and a half-written JSON file is indistinguishable from a corrupt one.

## What is verified, and what is not

Verified:

- The crate compiles, config and capabilities included, so the commands and the
  dialog and asset-scope calls are real.
- The Rust containment logic, the atomic write and the listing, by 16 tests
  under `cargo test` in this directory.
- The JavaScript adapter, by the full shared adapter conformance suite in
  `test/adapters/tauri.test.js`, run against a stand-in for `invoke` that
  refuses the same paths the Rust side refuses.

Not verified:

- A window that opens. Neither `cargo tauri dev` nor `cargo tauri build` has
  been run, so the window size, the CSP as the webview finally applies it, and
  the asset protocol streaming a real video are unproven. `cargo tauri dev`
  also needs `web/index.html` to exist.
- Anything on Windows or mobile.
