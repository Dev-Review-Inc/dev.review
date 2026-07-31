# The desktop shell

Tauri v2 wraps the same static frontend that is served in a browser, and adds
one thing the browser cannot offer everywhere: a folder on the local disk. The
File System Access API is Chromium-only, so a Safari or Firefox user has no
local reader at all. Inside this shell there is a real filesystem behind the IPC
boundary, and v2 targets iOS and Android from the same library entry point.

Tauri stops at the edge of the app. It is this directory and two frontend files
that talk to it, `web/src/adapters/tauri.js` and the native git transport in
`web/src/adapters/git-native.js`. The app code does not know the desktop
exists.

## Prerequisites

- Rust, stable, 1.88 or newer. Tauri itself asks for 1.77.2; its current
  dependency tree does not resolve below 1.88.
- macOS: Xcode command line tools.
- Windows: the Microsoft C++ build tools and WebView2 (WebView2 ships with
  Windows 11 and current Windows 10).
- The Tauri CLI, installed through Cargo rather than npm:

```sh
cargo install tauri-cli --version "^2" --locked
```

This project has no npm runtime or build dependencies and keeps it that way, so
`@tauri-apps/cli` and `@tauri-apps/api` are deliberately absent. The frontend
reaches Tauri through `globalThis.__TAURI__`, which `withGlobalTauri` puts
there.

## Running

```sh
cargo tauri dev      # from this directory
cargo tauri build    # produces the .app/.dmg or the .exe installer
```

There is no `beforeDevCommand` and no `beforeBuildCommand` because there is
nothing to build: `frontendDist` points at `../web`, which is already the
shipped artifact - `index.html` plus vanilla ES modules, no bundler. Editing a
file under `web/` and reloading the window is the whole development loop.

Run both from this directory rather than the repository root. `rust-toolchain.toml`
lives here, so only here does the toolchain resolve to the stable this crate
needs; from the root you get whatever the machine's default is, which on a
machine pinned below 1.88 fails while naming a transitive crate. The same
applies to installing the CLI, so `cargo install tauri-cli` wants running from
here too.

On macOS the DMG step shells out to `bundle_dmg.sh`, which drives Finder over
AppleScript to lay the window out. A shell without permission to send Apple
events to Finder gets `-1743` and the build fails after the `.app` is already
written. Setting `CI=true` skips that step and produces a plain, functional DMG:

```sh
CI=true cargo tauri build
```

Continuous integration sets `CI` itself, so this is only ever typed by hand, and
only on a machine that has not granted the automation permission.

`bundle.targets` names `nsis` alongside `app` and `dmg`. The bundler filters the
list by platform, so on macOS the Windows installer is passed over silently
rather than warned about or attempted; the one list serves both platforms.

`app-icon.svg` is the icon this app ships, and `app-icon.png` is it rendered at
1024x1024 with an alpha channel, which is what the generator reads. It is the
desktop cut of `web/icon.svg`: same panel, same glyph, same palette. What
differs is the frame. The web icon is full bleed with its own 112 radius,
because a browser and an Android launcher round or mask it themselves. macOS
rounds nothing, and every icon beside it in the Dock is a squircle of 824 inside
a canvas of 1024 with the rest transparent, so a full bleed square reads as too
large with the wrong corner. The desktop source insets the panel by 100 a side
and scales the glyph 824/512 to match. `web/icon-maskable.svg` is the wrong
source for the same reason from the other direction: it is square to the edge
with the glyph shrunk to survive a circular crop no desktop applies.

To regenerate after editing the SVG:

```sh
rsvg-convert -w 1024 -h 1024 app-icon.svg -o app-icon.png
cargo tauri icon app-icon.png
```

The generator also writes iOS, Android and Microsoft Store sets. Neither is a
build target here, so `icons/` keeps only the files `bundle.icon` names and the
rest are deleted after each run.

The bundler derives `Reviewer.icns` from whatever `bundle.icon` lists. That list
was one 512x512 PNG for a while, which produced an `.icns` holding a single
entry with nothing at the sizes below it; it now holds ten, 16 through 1024, so
the Finder and the Dock each get a rendering drawn for their size rather than
one resampled from 512. At 16 the diff lines behind the check disappear and the
check itself survives as a diagonal stroke: recognisable in a list beside the
same icon at larger sizes, not legible on its own. That is the glyph's floor,
not the ladder's.

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
- The nine `git_*` commands are the same arrangement over a second root, so
  they added no capability either. `git_root` is the reason: the clone lives
  under the app's own data directory, which Tauri hands to Rust, so the one
  absolute path the frontend ever learns came from Tauri rather than from a
  setting. `git_open`, `git_tree`, `git_read`, `git_commit_file`,
  `git_commit_removal`, `git_pull`, `git_push` and `git_ready` take that root
  back and resolve every path inside it. Running git is a subprocess this crate
  spawns itself, not the `shell` plugin, which stays ungranted: the frontend
  can ask for these nine operations and cannot name a program.

## Driving git

`src/git.rs` shells out to the git already on the machine, so the customer's
credential helpers, ssh agent and proxy settings keep working. Three things
about that are security boundaries rather than housekeeping:

- **The token goes through the environment.** It is set as `GIT_CONFIG_KEY_*`
  and `GIT_CONFIG_VALUE_*` on the child rather than passed with `-c`, because
  argv is readable by any process on the machine, and rather than written into
  `.git/config`, because that outlives the run. It is still readable by the
  same user and by root, and it is still sent to the git host, which is what it
  is for. `http.followRedirects` is false so it cannot be carried to a host the
  customer did not name.
- **No hook ever runs.** `core.hooksPath` points at a path inside `.git` that
  does not exist, commits are made with `--no-verify`, and `.git` is refused as
  a path component, so nothing the repository carries can install one.
- **Only `https://` remotes.** Git's other transports run a program named in
  the url, and `ext::` runs whatever it is handed.

`GIT_TERMINAL_PROMPT` is `0`: a desktop app has no terminal to prompt at, so a
missing credential fails rather than hanging forever. Commits are unsigned
(`commit.gpgsign=false`) and authored as Reviewer, because the app is what
wrote them.

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
  under `cargo test` in this directory, and the git commands by 23 more beside
  them, against real repositories on disk.
- The JavaScript adapter, by the full shared adapter conformance suite in
  `test/adapters/tauri.test.js`, run against a stand-in for `invoke` that
  refuses the same paths the Rust side refuses.
- `cargo tauri build` on macOS, Apple silicon. It bundles both `Reviewer.app`
  and `Reviewer_0.1.0_aarch64.dmg`, and the `.app` launches, stays up and opens
  a top-level window with its menu bar. The window comes up at the configured
  width; the height is whatever the display leaves once the menu bar and title
  bar are taken, so on a short screen it is less than the 860 asked for.
- The icon, by extracting `Reviewer.icns` back out of the built `.app` with
  `iconutil` and rendering every entry at its own pixel size on a light and a
  dark background. The Dock itself is still unphotographed: screen recording is
  denied here, so the sizes were read out of the bundle rather than off a screen.

Not verified:

- What the window contains. The build machine had no screen recording
  permission, so the webview was confirmed to exist and be composited rather
  than read pixel by pixel. The CSP as the webview finally applies it and the
  asset protocol streaming a real video are still unproven.
- The remote font stylesheet `web/index.html` links from `fonts.googleapis.com`.
  `style-src` is `'self' 'unsafe-inline'`, which does not cover it, so inside the
  shell the type falls back to `system-ui` where the browser build gets IBM Plex
  Sans. Nothing breaks, and widening `style-src` to reach a third party to fix
  cosmetics is the worse trade.
- Anything on Windows or mobile.
