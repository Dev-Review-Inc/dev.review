// The settings panel's own arithmetic: what a nav row says a source resolves
// to, when a group header carries a count, what colour that count wears, when
// a form counts as dirty, and what the one status line under the fields says.
//
// All pure, all tested apart from the DOM, because each is a sentence the
// reader acts on and a wrong sentence here reads as a broken source.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  attention,
  destinationDirty,
  readsWhat,
  resolvedSource,
  sourceDirty,
  statusLine,
  storageOptions,
  syncWord,
  folderWork,
} from "../../web/src/app/header.js";

describe("what a nav row resolves a source to", () => {
  test("an s3 source is its url, with the prefix only when there is one", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "s3", bucket: "notes", prefix: "team/" } }, ""),
      "s3://notes/team",
    );
    assert.equal(resolvedSource({ adapter: { type: "s3", bucket: "notes" } }, ""), "s3://notes");
  });

  test("a desktop source is its root path", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "tauri", root: "/home/d/notes" } }, ""),
      "/home/d/notes",
    );
  });

  test("a browser folder is the remembered folder's name, or an honest shrug", () => {
    assert.equal(resolvedSource({ adapter: { type: "filesystem" } }, "org"), "org/");
    assert.equal(
      resolvedSource({ adapter: { type: "filesystem" } }, ""),
      "folder on this computer",
    );
  });

  test("a github source is the repository, with the prefix only when there is one", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "github", owner: "dev", repo: "review" } }, ""),
      "github.com/dev/review",
    );
    assert.equal(
      resolvedSource(
        { adapter: { type: "github", owner: "dev", repo: "review", prefix: "reviews/" } },
        "",
      ),
      "github.com/dev/review/reviews",
    );
  });

  test("a github source names its branch only when it is not the default", () => {
    assert.equal(
      resolvedSource(
        { adapter: { type: "github", owner: "dev", repo: "review", branch: "main" } },
        "",
      ),
      "github.com/dev/review",
    );
    assert.equal(
      resolvedSource(
        {
          adapter: { type: "github", owner: "dev", repo: "review", branch: "drafts", prefix: "r" },
        },
        "",
      ),
      "github.com/dev/review/r#drafts",
    );
  });

  test("a git source is its remote, read the way a person says it", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "git", url: "https://git.dev/org/reviews.git" } }, ""),
      "git.dev/org/reviews",
    );
    assert.equal(
      resolvedSource(
        {
          adapter: {
            type: "git",
            url: "https://git.dev/org/reviews.git",
            branch: "drafts",
            prefix: "/reviews/",
          },
        },
        "",
      ),
      "git.dev/org/reviews/reviews#drafts",
    );
  });

  // The same repository can be written three ways, and a reader who moved from
  // https to ssh has not moved repository, so the row must not say they have.
  test("a git source reads the same however the remote is written", () => {
    const location = "github.com/org/reviews";

    assert.equal(
      resolvedSource({ adapter: { type: "git", url: "https://github.com/org/reviews.git" } }, ""),
      location,
    );
    assert.equal(
      resolvedSource(
        { adapter: { type: "git", url: "ssh://git@github.com:22/org/reviews.git" } },
        "",
      ),
      location,
    );
    assert.equal(
      resolvedSource({ adapter: { type: "git", url: "git@github.com:org/reviews.git" } }, ""),
      location,
    );
  });

  // The port is how the connection is made, not where the drafts are.
  test("a git source drops the port and the conventional git@ user", () => {
    const line = resolvedSource(
      { adapter: { type: "git", url: "ssh://git@git.dev:2222/org/reviews.git" } },
      "",
    );

    assert.equal(line, "git.dev/org/reviews");
    assert.doesNotMatch(line, /22/);
    assert.doesNotMatch(line, /git@/);
  });

  test("an ssh remote carries a prefix and a branch like any other", () => {
    assert.equal(
      resolvedSource(
        {
          adapter: {
            type: "git",
            url: "git@github.com:org/reviews.git",
            branch: "drafts",
            prefix: "/reviews/",
          },
        },
        "",
      ),
      "github.com/org/reviews/reviews#drafts",
    );
  });

  // A url can be pasted with a credential in it. The nav row is on screen while
  // someone reads over a shoulder, so it never shows one.
  test("a git source never repeats a credential someone pasted into the url", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "git", url: "https://me:ghp_x@git.dev/org/r.git" } }, ""),
      "git.dev/org/r",
    );
    assert.equal(
      resolvedSource(
        { adapter: { type: "git", url: "ssh://me:ghp_x@git.dev:22/org/r.git" } },
        "",
      ),
      "git.dev/org/r",
    );
    assert.equal(
      resolvedSource({ adapter: { type: "git", url: "me:ghp_x@git.dev:org/r.git" } }, ""),
      "git.dev/org/r",
    );
  });

  // Whatever was typed is what the reader has to recognise to correct it, so a
  // url this cannot parse is still shown rather than thrown over.
  test("a git remote that parses as nothing still says what was typed", () => {
    assert.equal(
      resolvedSource({ adapter: { type: "git", url: "not a url" } }, ""),
      "not a url",
    );
  });

  test("a backend this build has never heard of still says something", () => {
    assert.equal(resolvedSource({ adapter: { type: "svn" } }, ""), "svn");
    assert.equal(resolvedSource({ adapter: { type: "git" } }, ""), "git");
  });
});

describe("a backend that works here but asks something of the reader", () => {
  // Git in a browser needs a proxy, which is a caveat and not a refusal. The
  // hint carries it; an empty reason must leave the option selectable, because
  // greying out the one backend that does work would be a lie.
  const types = [
    { type: "git", label: "A git repository", reason: "", hint: "In a browser this needs a cors proxy." },
    { type: "tauri", label: "This computer", reason: "needs the desktop app", hint: "" },
  ];

  test("stays selectable, with nothing added to its own text", () => {
    const [git] = storageOptions(types);

    assert.equal(git.disabled, false);
    assert.equal(git.label, "A git repository");
  });

  // The hint is drawn under the picker rather than inside the option, so the
  // option's text is the label alone and a reason is the only thing that
  // disables anything.
  test("a reason is still what disables an option", () => {
    const [, tauri] = storageOptions(types);

    assert.equal(tauri.disabled, true);
    assert.equal(tauri.label, "This computer (needs the desktop app)");
  });
});

describe("the count a group header carries", () => {
  test("counts only the rows needing attention", () => {
    const { count } = attention([{ state: "ok" }, { state: "warn" }, { state: "broken" }, null]);

    assert.equal(count, 2);
  });

  test("wears the worst colour present", () => {
    assert.equal(attention([{ state: "warn" }]).tone, "warn");
    assert.equal(attention([{ state: "warn" }, { state: "broken" }]).tone, "bad");
    assert.equal(attention([{ state: "ok" }, null]).tone, "");
  });
});

describe("when the source form counts as dirty", () => {
  const stored = { name: "Work", adapter: { type: "s3", bucket: "notes", region: "us-east-1" } };
  const fields = [
    { key: "bucket" },
    { key: "region" },
    { key: "accessKeyId", secret: true },
  ];

  function setup(overrides = {}) {
    return {
      editing: stored,
      name: "Work",
      type: "s3",
      values: { bucket: "notes", region: "us-east-1" },
      handle: null,
      ...overrides,
    };
  }

  test("clean when everything reads back as stored", () => {
    assert.equal(sourceDirty(setup(), fields), false);
  });

  test("adding is never dirty, because there is nothing to differ from", () => {
    assert.equal(sourceDirty(setup({ editing: null }), fields), false);
  });

  test("a changed name, value, backend or a fresh folder each make it dirty", () => {
    assert.equal(sourceDirty(setup({ name: "Wrok" }), fields), true);
    assert.equal(sourceDirty(setup({ values: { bucket: "typo", region: "us-east-1" } }), fields), true);
    assert.equal(sourceDirty(setup({ type: "filesystem" }), fields), true);
    assert.equal(sourceDirty(setup({ handle: { name: "notes" } }), fields), true);
  });

  test("a typed secret is dirty; a blank secret box means unchanged", () => {
    const typed = setup({ values: { bucket: "notes", region: "us-east-1", accessKeyId: "AK" } });

    assert.equal(sourceDirty(typed, fields), true);
    assert.equal(
      sourceDirty(setup({ values: { bucket: "notes", region: "us-east-1", accessKeyId: "" } }), fields),
      false,
    );
  });
});

describe("when a repository source's form counts as dirty", () => {
  const stored = {
    name: "Reviews",
    adapter: { type: "github", owner: "dev", repo: "review", branch: "main" },
  };
  const fields = [
    { key: "owner" },
    { key: "repo" },
    { key: "branch" },
    { key: "prefix" },
    { key: "token", secret: true },
  ];

  function setup(overrides = {}) {
    return {
      editing: stored,
      name: "Reviews",
      type: "github",
      values: { owner: "dev", repo: "review", branch: "main" },
      handle: null,
      ...overrides,
    };
  }

  test("clean when everything reads back as stored", () => {
    assert.equal(sourceDirty(setup(), fields), false);
  });

  // A field the reader never filled in is stored as nothing and reads back as
  // an empty box, which is the same answer twice rather than a change.
  test("a field left blank both times is not a change", () => {
    assert.equal(sourceDirty(setup({ values: { owner: "dev", repo: "review", branch: "main", prefix: "" } }), fields), false);
  });

  test("a moved branch or a new prefix makes it dirty", () => {
    assert.equal(
      sourceDirty(setup({ values: { owner: "dev", repo: "review", branch: "drafts" } }), fields),
      true,
    );
    assert.equal(
      sourceDirty(
        setup({ values: { owner: "dev", repo: "review", branch: "main", prefix: "reviews" } }),
        fields,
      ),
      true,
    );
  });

  test("a typed token is dirty; a blank token box means keep the stored one", () => {
    assert.equal(
      sourceDirty(setup({ values: { owner: "dev", repo: "review", branch: "main", token: "ghp" } }), fields),
      true,
    );
    assert.equal(
      sourceDirty(setup({ values: { owner: "dev", repo: "review", branch: "main", token: "" } }), fields),
      false,
    );
  });

  test("a git source counts the same way, over its own fields", () => {
    const repository = {
      name: "Reviews",
      adapter: { type: "git", url: "https://git.dev/org/reviews.git", branch: "main" },
    };
    const gitFields = [
      { key: "url" },
      { key: "branch" },
      { key: "corsProxy" },
      { key: "token", secret: true },
    ];
    const values = { url: "https://git.dev/org/reviews.git", branch: "main" };
    const form = (overrides = {}) => ({
      editing: repository,
      name: "Reviews",
      type: "git",
      values,
      handle: null,
      ...overrides,
    });

    assert.equal(sourceDirty(form(), gitFields), false);
    assert.equal(
      sourceDirty(form({ values: { ...values, corsProxy: "https://cors.dev" } }), gitFields),
      true,
    );
  });
});

describe("when the destination form counts as dirty", () => {
  const stored = { label: "GitHub", type: "github" };

  test("clean when the label reads back and no token was typed", () => {
    assert.equal(destinationDirty({ editing: stored, label: "GitHub", values: {} }), false);
    assert.equal(destinationDirty({ editing: null, label: "x", values: { token: "t" } }), false);
  });

  test("a changed label or a typed token makes it dirty", () => {
    assert.equal(destinationDirty({ editing: stored, label: "Work", values: {} }), true);
    assert.equal(destinationDirty({ editing: stored, label: "GitHub", values: { token: "t" } }), true);
  });
});

describe("what the status line says is being read", () => {
  // A backend that asks for its location in a form is one worth quoting back.
  // A folder that was picked is already named by the row above it.
  test("quotes the location of storage that was typed", () => {
    const bucket = { adapter: { type: "s3", bucket: "notes", prefix: "team/" } };
    const repository = { adapter: { type: "github", owner: "dev", repo: "review" } };

    assert.equal(readsWhat(bucket, [{ key: "bucket" }]), "s3://notes/team/drafts/");
    assert.equal(readsWhat(repository, [{ key: "owner" }]), "github.com/dev/review/drafts/");
  });

  test("says only the folder for storage that was chosen", () => {
    assert.equal(readsWhat({ adapter: { type: "filesystem" } }, []), "drafts/");
    assert.equal(readsWhat({ adapter: { type: "tauri", root: "/home/d" } }, []), "drafts/");
  });
});

describe("the status line under the fields", () => {
  test("says nothing before the source has been looked at", () => {
    assert.deepEqual(statusLine(null, "drafts/"), { text: "", tone: "" });
  });

  test("a healthy source quotes what it reads, how much, and when", () => {
    const { text, tone } = statusLine(
      { state: "ok", reason: "", drafts: 14, at: Date.now() },
      "drafts/",
    );

    assert.equal(text, "reads drafts/ · 14 drafts · checked 0m ago");
    assert.equal(tone, "");
  });

  test("one draft is one draft", () => {
    const { text } = statusLine({ state: "ok", reason: "", drafts: 1, at: Date.now() }, "drafts/");

    assert.match(text, /1 draft ·/);
  });

  test("a warning or a break is the probe's own words, in its colour", () => {
    assert.deepEqual(statusLine({ state: "warn", reason: "No drafts are waiting here." }, "x"), {
      text: "No drafts are waiting here.",
      tone: "warn",
    });
    assert.deepEqual(statusLine({ state: "broken", reason: "denied" }, "x"), {
      text: "denied",
      tone: "bad",
    });
  });
});

describe("what the app does inside a source's folder", () => {
  const source = { adapter: { type: "filesystem" } };

  test("names the folder it is all relative to", () => {
    assert.equal(folderWork(source, "my", "ab12").at, "my/");
  });

  test("lists the drafts as read and never written", () => {
    const [drafts] = folderWork(source, "my", "ab12").does;

    assert.equal(drafts.path, "drafts/");
    assert.match(drafts.doing, /^read\b/);
    assert.match(drafts.doing, /never/);
  });

  test("names this device's own log, and says it is written", () => {
    const [, mine] = folderWork(source, "my", "ab12").does;

    assert.equal(mine.path, ".reviewer/events/ab12.jsonl");
    assert.match(mine.doing, /^written\b/);
  });

  test("lists the other devices' logs as read", () => {
    const [, , theirs] = folderWork(source, "my", "ab12").does;

    assert.equal(theirs.path, ".reviewer/events/");
    assert.match(theirs.doing, /^read\b/);
  });

  test("names a remote location the same way", () => {
    const bucket = { adapter: { type: "s3", bucket: "notes", prefix: "team/" } };

    assert.equal(folderWork(bucket, "", "ab12").at, "s3://notes/team/");
  });

  // The whole point is that it quotes real locations. A handle the browser has
  // forgotten leaves nothing to quote, so it says nothing.
  test("says nothing when the location cannot be named", () => {
    assert.equal(folderWork(source, "", "ab12"), null);
  });
});

// The word under a saved source's form is the only place the app ever says a
// reader's decisions are written. It is drawn from a count that is itself a
// read of storage, so it has three answers to give and not two: none waiting,
// some waiting, and no idea. Collapsing the third into the first is how "three
// decisions are only on this laptop" gets shown as "saved".
describe("what the settings foot says about decisions waiting to sync", () => {
  test("says everything landed when nothing is waiting", () => {
    assert.equal(syncWord(0).text, "saved");
    assert.equal(syncWord(0).tone, "");
  });

  test("counts what is waiting, in the reader's number", () => {
    assert.equal(syncWord(1).text, "1 decision waiting to sync");
    assert.equal(syncWord(3).text, "3 decisions waiting to sync");
    assert.equal(syncWord(3).tone, "bad");
  });

  test("does not say saved when the count could not be read", () => {
    assert.notEqual(syncWord(null).text, "saved");
  });

  test("says the count is what could not be read, and wears the warning", () => {
    assert.match(syncWord(null).text, /could not be checked/);
    assert.equal(syncWord(null).tone, "bad");
  });
});
