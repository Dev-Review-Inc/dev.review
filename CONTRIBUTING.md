# Contributing

Issues and pull requests are welcome. Everything lands through a pull request,
including the maintainer's own, so that every change has a place where it was
read before it landed.

Nothing enforces that yet. Branch protection and rulesets both need GitHub Pro
or a public repository, and this one is neither, so `main` is convention rather
than a rule today. When protection is switched on, the check a rule has to
require is named `test / test`: the suite lives in its own workflow so two
callers can wait on it, and a called workflow reports its jobs as
`<calling job> / <called job>`. A rule naming a check nobody reports blocks
every pull request while looking correct.

## Signing off

Every commit needs a `Signed-off-by` line. It certifies that you wrote the
change, or otherwise have the right to submit it under this project's licence.
The full text is in [DCO](DCO).

Git adds the line for you:

```bash
git commit -s -m "your message"
```

If you forget on the last commit, `git commit --amend -s --no-edit` fixes it.

## Running it

No dependencies to install. The browser app is plain ES modules and the server
is a Go module with an empty require block.

```bash
npm run test:units
```

```bash
cd serve && go test ./...
```

The interface, served from the working tree so edits reload:

```bash
cd serve && go run . -dir ../web -dev
```

`-dir` on its own prepares the whole tree once at startup, so an edit does not
appear until the process restarts, refresh or no refresh. `-dev` is what makes
the server read from disk per request, stop the browser holding a response, and
reload the page when a file changes.

Turn on the same checks CI runs, once per clone:

```bash
git config core.hooksPath .githooks
```

## What a good pull request looks like

**One change, with a test.** The test is what says the change is real. A fix
without one is a claim; a fix with one is a fix.

**A message that says why.** The subject line says what changed, the body says
what was wrong before. Someone reading `git log` in a year is the audience.

**No new dependencies.** The app ships to a browser with none and the server
has none, and that is a property worth keeping rather than an accident. A pull
request that adds one needs to argue for it first, in an issue. The desktop
shell does have a crate tree, and a change to it means re-checking
[THIRD-PARTY.md](THIRD-PARTY.md), which carries the command that finds anything
needing a notice.

**Comments explain the why, never the what.** The code says what it does.

## The contract

The integration is one JSON file, described in
[docs/draft-schema.md](docs/draft-schema.md). Anything that writes that file
feeds this interface, which is the whole point of publishing it: the app is not
coupled to any particular agent, storage backend or git host, and changes that
would couple it are the ones most likely to be turned down.

Changing the schema is a versioned, breaking change. Open an issue before
writing the code.

## Reporting something sensitive

Do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).
