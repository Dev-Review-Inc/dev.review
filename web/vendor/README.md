# Vendored third-party code

`web/src` is served as raw ES modules under a `script-src 'self'` CSP. There is
no bundler and no `node_modules`, so a dependency either lives in this directory
or it does not exist. Nothing here may reach the network at import time.

| File | Package | Version | Licence |
| --- | --- | --- | --- |
| `isomorphic-git.js` | `isomorphic-git` | 1.40.0 | MIT |
| `isomorphic-git-http.js` | `isomorphic-git` (web http client) | 1.40.0 | MIT |
| `lightning-fs.js` | `@isomorphic-git/lightning-fs` | 4.7.0 | MIT |

Each file carries its own header giving the exact source URL. The bodies are
upstream byte for byte; the only additions are that header and, where upstream
ships UMD, a few lines of wrapper.

## Exports

```js
import git from "./vendor/isomorphic-git.js";        // default only: git.clone, git.TREE, git.Errors, ...
import http from "./vendor/isomorphic-git-http.js";  // default, plus named `request`
import FS from "./vendor/lightning-fs.js";           // default: the constructor
```

`isomorphic-git.js` and `lightning-fs.js` come from UMD builds, so their whole
API hangs off the default export. There are no named exports to destructure at
import time.

## Re-vendoring

```sh
curl -L https://cdn.jsdelivr.net/npm/isomorphic-git@VERSION/index.umd.min.js
curl -L https://cdn.jsdelivr.net/npm/isomorphic-git@VERSION/http/web/index.js
curl -L https://cdn.jsdelivr.net/npm/@isomorphic-git/lightning-fs@VERSION/dist/lightning-fs.min.js
```

Keep the existing headers and wrappers, swap the bodies, then check the result
still stands alone:

```sh
grep -nE "from ['\"]|\bimport\s*\(|\brequire\s*\(" web/vendor/*.js   # must be empty
node --input-type=module -e "import g from './web/vendor/isomorphic-git.js'; console.log(typeof g.clone)"
```

Do not re-vendor `isomorphic-git` from esm.sh. Its bundle output still emits
`/node/buffer.mjs`, `/node/process.mjs` and a sub-import of the bundle itself,
all of which need the network. The UMD is the only self-contained distribution.

## Licences

Both packages are MIT, which requires the copyright notice and permission text
to travel with the code rather than be linked to. They are here:

| Licence | Covers |
| --- | --- |
| `LICENSE-isomorphic-git.md` | `isomorphic-git.js`, `isomorphic-git-http.js` |
| `LICENSE-lightning-fs.md` | `lightning-fs.js` |

Re-vendoring at a new version means re-fetching these too, in case the notice
has changed.
