# Security

## Reporting

Email **<hello@dev.review>**. Do not open a public issue.

Please include what you did, what happened, and what you expected. If you have
a proof of concept, say so rather than attaching it to a first email.

## What is worth reporting

This app holds credentials and reads files you point it at, so the things that
matter most are:

- **Anything that gets a token off the page.** Tokens live in local storage on
  the app's own origin, so any script running there can read one. The content
  security policy exists to make sure nothing but this origin's own code ever
  runs. A way past it is the most serious report we can receive.
- **Anything that reads or writes outside the storage a source names.** Paths
  from a draft reach the adapters, so containment is checked in the adapter as
  well as in the parser. A path that escapes either is a bug in both.
- **Anything a draft file can do to the reader.** Drafts are written by agents
  and are not trusted input. Markdown is escaped and a small allowlist is
  restored afterwards; a way to get script through that is a real finding.
- **Anything a repository can do to the machine.** A git source clones a
  repository other people write to, so its contents are not trusted either. See
  below for what is refused.

## Git, and what it costs

Attaching a git repository puts a credential somewhere it was not before. Both
transports are worth understanding before you attach one.

### A browser needs a CORS proxy, and the proxy sees the credential

No git host sends the CORS headers a tab needs, so in a browser the smart-HTTP
requests go through a proxy you name. Forwarding the `Authorization` header is
what makes it work, so the token travels through the proxy operator's server.

That is a real exposure, not a theoretical one. **Whoever runs the proxy can
read the token you push with**, and that token is write-scoped, because the app
commits your decisions. Run the proxy yourself, or use the desktop app, which
needs none.

A git CORS proxy is a relay, not a gate. `@isomorphic-git/cors-proxy`, the one
this was built against, answers only the smart-HTTP paths and forwards only the
headers on its own allowlist, in both directions. As of 3.x it has no
authentication of any kind: no key, no token, no setting for one. So there is no
proxy credential to configure and this app does not ask for one. A header it
does not know is not quietly dropped either, it is refused by the browser at
preflight, which is why inventing one would break every request rather than
degrade quietly.

Point `cors proxy` at the proxy's origin with no trailing `?`. That form sends
the url as a path with its scheme stripped, which is the only shape this proxy
parses.

### Which remotes are accepted, and why the list is short

Two forms only: `https://host/path`, and ssh as either `ssh://[user@]host[:port]/path`
or the scp shorthand `git@host:path`. Everything else is refused by not being on
the list, in the adapter and again in Rust.

That is a boundary rather than tidiness. Several of git's transports run a
program the url chooses, `ext::` most directly, so a url that reaches them is a
url that reaches a shell. A doubled colon is checked before the scp form,
because `ext::x` is otherwise a perfectly ordinary looking host called `ext`.

The subtler one is argument injection. Git hands the hostname to `ssh`, so a
host or user beginning with `-` arrives as an option rather than as a name, and
an option can name a command. Any component starting with `-` is refused, in
every form including https, before anything is parsed. So are whitespace,
control characters, and anything outside printable ascii, which is how one
argument becomes two, one line becomes two, and one host impersonates another.

An ssh remote needs no token: the keys, the agent and `known_hosts` are the
machine's, not this app's. `StrictHostKeyChecking` is left alone and no host key
is ever recorded, so a first connection to an unknown host fails rather than
being trusted silently. `BatchMode=yes` is set so a passphrase-protected key
fails fast instead of hanging on a prompt no window is showing.

ssh is desktop only. A browser has no keys and no agent, so the browser
transport says a repository needs the desktop app rather than failing in a way
that sends you to look at your proxy.

### The native transport keeps the token out of the obvious places

The desktop build drives the git already on the machine. The token is passed
through `GIT_CONFIG_*` in the child process's environment rather than through
`-c` on the command line or a write into `.git/config`, so it is not in `ps`
output and not left on disk in the clone.

That is narrower than it sounds. The environment of a process is readable by
the same user and by root, and the token is sent to the git host as an
`Authorization` header, which is the point of having it. Redirects are refused
(`http.followRedirects=false`) so that header cannot be carried to a host you
did not name.

### Removing a source deletes the clone

A git source keeps a whole copy of the repository on the machine: a folder
under the app's own data directory on the desktop, and the same tree in
IndexedDB in a browser. Removing the source deletes it. A remove that left your
source code behind would be a delete that deleted nothing, so this is a
guarantee rather than a tidy-up.

It is best effort by design. A copy that cannot be deleted is reported but is
never what stops the source being removed, because the alternative is a source
nobody can get rid of. The repository on the host is untouched either way.

The delete is the most dangerous thing this app does to a disk, so it is
narrow. The folder is resolved through the same containment as every other
path, then canonicalized, and the app data directory must be its parent. That
one comparison proves it is inside the base, exactly one level down, and not
the base itself, after symlinks have been followed rather than before. A clone
directory replaced with a link elsewhere is refused, not followed.

### Repository-supplied code is never run

A hook is a script the repository carries, and running one would be the
repository executing code on your machine.

- `core.hooksPath` is pointed at a path that does not exist, and commits are
  made with `--no-verify`. No hook runs, whoever wrote it.
- `.git` is refused as a path component, so no path from a draft can reach the
  repository's own directory and install one.
- No remote that names a program is accepted. https and ssh are on the list
  because neither lets the url choose what runs; git's other transports do, and
  `ext::` runs whatever it is handed. The list above is the whole of it.

## What is not a vulnerability

- `connect-src 'self' https:` is deliberate. The storage adapter talks to an
  endpoint the customer configures at runtime, unknown when the binary is
  built, so an allowlist would mean only endpoints we had heard of would work.
  With `script-src 'self'` there is no attacker script on the page to abuse it.
- Third-party code under `web/vendor/`. `script-src 'self'` means a CDN import
  would not load, and there is no bundler here, so a dependency is vendored
  into the repository or it does not exist. Each file names the exact source it
  came from and is upstream byte for byte. A vendored file that does **not**
  match its upstream is worth reporting; the arrangement itself is the point.
- A missing security header on a response that carries no credential and no
  script.
- Findings from a scanner, with no path to an actual effect described.
