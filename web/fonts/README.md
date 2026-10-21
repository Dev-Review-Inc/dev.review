# Vendored fonts

The interface is drawn in IBM Plex Sans and JetBrains Mono. Both are shipped
here rather than fetched from Google.

They are not in `web/vendor/`. That directory holds ES modules that `web/src`
imports under `script-src 'self'`, and its README is written around that: what
each file exports, how to re-vendor it from npm, and the rule that nothing there
may reach the network at import time. A font is not code, nothing imports it,
and it is named by a URL in a CSS rule. Putting it there would make the first
paragraph of that README false. The notices below follow the same shape.

## Why they are here

A font from `fonts.gstatic.com` is a request the reader did not ask for, and it
tells Google which readers opened the app. The desktop build refused it anyway:
`src-tauri/tauri.conf.json` has no Google origin in `style-src` and declared no
`font-src`, so the Tauri window fell back to system fonts while the browser
build looked correct. Self-hosted, the same bytes load under `font-src 'self'`
in every build, and the service worker keeps them for offline along with every
other same-origin file.

## The files

Both families are variable fonts. Google serves one file per family per subset
and varies the weight axis inside it, so the five weights the interface asks for
are four files and not five.

| File | Family | Weights | Subset | Size |
| --- | --- | --- | --- | --- |
| `ibm-plex-sans-latin.woff2` | IBM Plex Sans | 400-600 | latin | 40240 |
| `ibm-plex-sans-latin-ext.woff2` | IBM Plex Sans | 400-600 | latin-ext | 25868 |
| `jetbrains-mono-latin.woff2` | JetBrains Mono | 400-700 | latin | 31340 |
| `jetbrains-mono-latin-ext.woff2` | JetBrains Mono | 400-700 | latin-ext | 11596 |

Only `latin` and `latin-ext` are kept. Google also offers cyrillic, cyrillic-ext,
greek and vietnamese. The interface's own chrome is English, and the prose it
draws is whatever GitHub hands back, so `latin-ext` is here for Central and
Eastern European names and titles. `latin-ext` costs a reader nothing until they
meet a character in it: the `unicode-range` on each rule is what decides whether
the browser fetches the file at all. Anything outside both ranges, emoji
included, falls back per character to the system font.

The `@font-face` rules are in `web/index.html` beside the rest of the styles,
because `web/` has no build step and no separate stylesheet.
`test/ui/fonts.test.js` checks that every file a rule names is here, and that
nothing reaches Google again.

## Re-vendoring

Ask the Google Fonts CSS endpoint with a browser User-Agent. An older agent is
answered with `ttf` or `woff` instead of `woff2`.

```sh
curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" \
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;700&display=swap'
```

The answer is one `@font-face` block per weight per subset. Take the `src` URL
from the `latin` and `latin-ext` blocks of each family and fetch those. The
blocks for 400, 500 and 600 of one family name the same file, which is how the
table above is four files.

Copy the `unicode-range` from the same blocks into `web/index.html` rather than
writing it out, because it is what makes the subsetting work.

## Licences

Both families are under the SIL Open Font License 1.1, which permits
redistribution as long as the copyright notice and the licence travel with the
files. They are here:

| Licence | Covers | Copyright |
| --- | --- | --- |
| `LICENSE-ibm-plex.txt` | `ibm-plex-sans-*.woff2` | IBM Corp., Reserved Font Name "Plex" |
| `LICENSE-jetbrains-mono.txt` | `jetbrains-mono-*.woff2` | The JetBrains Mono Project Authors |

Each is the upstream file, byte for byte:

- <https://github.com/IBM/plex/blob/master/LICENSE.txt>
- <https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt>

The licence reserves the names "Plex" and "JetBrains Mono" for the upstream
projects. These files are the upstream fonts unmodified, subset by Google, so
the names are used for what they name.

Re-vendoring means re-fetching these too, in case the notice has changed.
