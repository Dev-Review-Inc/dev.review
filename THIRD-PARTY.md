# Third-party notices

This project is Apache-2.0. The `.dmg` it ships is a signed binary with the Rust
dependency tree in `src-tauri/Cargo.lock` compiled into it, and a few of those
crates ask for something back.

The browser side is handled separately, in
[web/vendor/README.md](web/vendor/README.md): those packages are MIT and their
notices sit beside the code they cover.

## MPL-2.0

The Mozilla Public License is file-level copyleft. It leaves this project's own
licence alone, and it does not ask for anything about this project's own source.
It does ask that anyone given the binary is told the crate is in there, under
which licence, and where its source can be had.

| Crate | Version | Source |
| --- | --- | --- |
| `option-ext` | 0.2.0 | <https://github.com/soc/option-ext> |
| `cssparser` | 0.36.0 | <https://github.com/servo/rust-cssparser> |
| `cssparser-macros` | 0.6.1 | <https://github.com/servo/rust-cssparser> |
| `selectors` | 0.36.1 | <https://github.com/servo/stylo> |
| `dtoa-short` | 0.3.5 | <https://github.com/upsuper/dtoa-short> |

Every one is used unmodified, at the published version, straight from
crates.io. The source for any of them is also `cargo vendor` away from the lock
file in this repository, which pins the exact versions above.

Only `option-ext` reaches the shipped binary, by way of `dirs-sys` and `dirs`,
which `tauri` and `wry` both depend on. The other four arrive through
`tauri-utils` under `tauri-build` and the proc-macro crates, so they run at
build time and are not linked into what anyone downloads. They are listed
anyway, because the distinction is a Cargo feature-resolution detail that a
future dependency bump can quietly change, and a notice that is wrong in the
harmless direction costs nothing.

The licence text is at <https://www.mozilla.org/en-US/MPL/2.0/>.

## Everything else

The rest of the tree is permissive and asks only that its copyright notices
travel with any source redistribution: MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, ISC, Zlib, 0BSD, CC0-1.0, Unlicense, Unicode-3.0, and
Apache-2.0 WITH LLVM-exception. `r-efi` offers LGPL-2.1-or-later as one of
three choices; MIT is taken. There is no GPL, AGPL, CDDL, EPL or SSPL anywhere
in the tree.

## Checking this file

The lock file is the source of truth, so re-derive rather than trust the list:

```bash
cd src-tauri && cargo tree --locked --format "{p} {l}" |
  grep -E "(MPL|GPL|CDDL|EPL|SSPL)-[0-9]" | sed -E 's/^[^a-zA-Z]*//' | sort -u
```

The trailing `-[0-9]` is load-bearing and the match is case-sensitive on
purpose: `grep -i MPL` also matches every `*-impl` proc-macro crate in the tree.

Anything that turns up beyond the five crates above belongs in the table, with
its version and its upstream repository. `cargo tree` reads the host target
only, so a crate that appears just on Windows or Linux will not show on a Mac.
