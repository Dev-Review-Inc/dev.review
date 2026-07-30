# Contributing

Issues and pull requests are welcome. `main` is protected and only the
maintainer can push to it, so everything lands through a pull request from a
fork, including the maintainer's own.

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
cd serve && go run . -dir ../web
```

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
request that adds one needs to argue for it first, in an issue.

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
