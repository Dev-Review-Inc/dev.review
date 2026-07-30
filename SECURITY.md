# Security

## Reporting

Email **hello@dev.review**. Do not open a public issue.

Please include what you did, what happened, and what you expected. If you have
a proof of concept, say so rather than attaching it to a first email.

## What is worth reporting

This app holds one credential and reads files you point it at, so the things
that matter most are:

- **Anything that gets a GitHub token off the page.** The token lives in local
  storage on the app's own origin, so any script running there can read it. The
  content security policy exists to make sure nothing but this origin's own
  code ever runs. A way past it is the most serious report we can receive.
- **Anything that reads or writes outside the storage a source names.** Paths
  from a draft reach the adapters, so containment is checked in the adapter as
  well as in the parser. A path that escapes either is a bug in both.
- **Anything a draft file can do to the reader.** Drafts are written by agents
  and are not trusted input. Markdown is escaped and a small allowlist is
  restored afterwards; a way to get script through that is a real finding.

## What is not a vulnerability

- `connect-src 'self' https:` is deliberate. The storage adapter talks to an
  endpoint the customer configures at runtime, unknown when the binary is
  built, so an allowlist would mean only endpoints we had heard of would work.
  With `script-src 'self'` there is no attacker script on the page to abuse it.
- A missing security header on a response that carries no credential and no
  script.
- Findings from a scanner, with no path to an actual effect described.
