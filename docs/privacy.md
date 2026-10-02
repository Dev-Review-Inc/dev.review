# Privacy policy

Last updated 2 October 2026.

This policy covers Reviewer: the iOS app, the macOS app, and the web build you
serve yourself.

## The short version

The publisher of Reviewer collects nothing. The app has no account, no sign-up,
and no server that belongs to the publisher. Your data goes from your device to
GitHub, and to storage you already own. Nothing passes through the publisher on
the way.

## What the app handles

The app handles four kinds of data.

**Drafts.** An agent writes a draft review as a JSON file into your storage. The
app reads that file. The draft holds the pull request title, the diff, the
findings, and any recorded browser runs.

**Your decisions.** The app records what you decide while you read: which
findings you include, the text you edit, and the lines you tick as viewed. Each
decision is one immutable event in an append-only log.

**Credentials.** The app holds your GitHub personal access token, and the keys
for the storage you attach. You type them in. The app uses them and stores them
on the device.

**A device identifier.** The app generates a random identifier for each device.
It writes your event log to your storage as `.reviewer/events/<device>.jsonl`.
The identifier separates your devices so that two of them do not overwrite each
other. It is not an advertising identifier and it reaches nobody but your own
storage.

## Where the data goes

There is no server in the middle. The app calls `api.github.com` directly from
the device with your token, because GitHub permits cross-origin requests that
carry an `Authorization` header. It calls your storage endpoint directly with
your keys. The publisher operates no endpoint that the app sends your data to.

The web build is a static site. The file server in `serve/` has no route that
reads or writes data, no database, and no credential. The desktop app and the
iOS app run the same interface with no server at all.

## Where credentials are stored

**iOS.** The token sits in the iOS Keychain, under the service `dev.review`. A
Face ID prompt, Touch ID prompt, or device passcode prompt gates every read and
every write. The app asks once per launch, not once per read.

**A browser.** The token sits in IndexedDB on the app's own origin. Any script
running on that origin can read it, so the page carries a content security
policy that restricts script to that same origin.

**macOS.** The macOS app runs the same interface in a native window. The token
sits in IndexedDB inside that app's own storage.

Credentials never enter the event log, and the log is the only thing that syncs.
A credential that syncs is a credential that leaves the device you typed it
into. The app also never renders a stored credential back into the page.

## Third parties the app contacts

Every remote below is one you choose and configure. The app contacts no other
host.

**api.github.com.** The app reads pull requests and issues, and posts reviews,
comments, label changes, and description edits. Every call carries your token, so
GitHub sees the action as yours. GitHub's own privacy policy covers what GitHub
does with it.

**github.com and avatars.githubusercontent.com.** The app loads author pictures
from these two hosts. These requests carry no token. The service worker keeps the
pictures in a cache so that the app does not ask again.

**Your S3-compatible endpoint.** You name the bucket, the region, and the
endpoint. This can be AWS, Cloudflare R2, or MinIO on a machine in your office.
The app signs each request with SigV4 in the browser and sends the signature in a
header. It never puts a signature in a query string, because a query string ends
up in logs and in history.

**Your git remote.** A write to a git source is a commit. The desktop app drives
the git already on your machine. A browser has no git, so it speaks smart-HTTP
over the network.

**A git CORS proxy, if you name one.** No git host sends the CORS headers that a
browser tab needs. So in a browser, the git requests go through a proxy that you
name. The proxy forwards the `Authorization` header, which is what makes it work.
Whoever runs that proxy can read the token you push with, and that token is
write-scoped. Run the proxy yourself, or use the desktop app, which needs none.

**iCloud, on iOS only.** You can attach this app's own iCloud container as a
source. Your drafts and your event log then sit in your iCloud account, under
the container `iCloud.review.dev.app`. Apple holds that data for you, under your
Apple account.

## What the app does not do

The app contains no analytics, no telemetry, no crash reporting, and no tracking
beacon. There is nothing of that kind to switch off, because there is nothing of
that kind in the code.

There is no account with the publisher. There is no sign-up, no email list, and
no licence check that reports back.

The app loads no webfont from Google. The two typefaces ship inside the app. An
earlier version fetched them from Google on every launch, which told Google which
readers opened the app. That request is gone.

## Children

Reviewer is a tool for software developers. It is not directed at children. The
publisher collects no data from anybody, of any age.

## Retention and deletion

The publisher holds none of your data, so the publisher has nothing to retain and
nothing to delete. Your drafts and your event log live in the storage you chose,
and you decide how long they stay there.

To delete the app's local data, remove the source in the app, or delete the app.
Removing a git source also deletes the local clone of the repository. Deleting
the app removes its IndexedDB databases and its Keychain entries with it. The
data in your own storage, and the data on GitHub, are untouched by that. Delete
those where they live.

## Contact

Email <hello@dev.review> with any privacy question. Email the same address to
report a security problem, and do not open a public issue for one.
