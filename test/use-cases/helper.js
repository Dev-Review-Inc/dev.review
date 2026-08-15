// Building the app the way the app builds itself.
//
// The tests wire the real store, the real runners, the real commands and the
// real queries. Only the reader is swapped, for one that keeps nothing, so a
// use case test exercises the same path a browser does.

import { App } from "../../web/src/app/app.js";
import { MultiEventStore } from "../../web/src/state/multi-event-store.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { Drafts } from "../../web/src/state/drafts.js";
import { Sync } from "../../web/src/state/sync.js";
import runners from "../../web/src/state/runners.js";
import { Commands } from "../../web/src/commands/index.js";
import { Queries } from "../../web/src/queries/index.js";

/**
 * A draft as an agent would write it, with anything you want overridden.
 *
 * @param {object} [overrides] fields to change
 * @returns {object} a schema 3 draft
 */
export function aDraft(overrides = {}) {
  return {
    schema: 3,
    owner: "org",
    repo: "app",
    number: 42,
    title: "Re-root the errors onto a common base class",
    url: "https://github.com/org/app/pull/42",
    reviewedAt: "e612b1b",
    finishedAt: "2026-07-29T15:41:10Z",
    verdict: "COMMENT",
    summary: "Re-rooted correctly, but the family catch-all is now inert.",
    sections: [{ key: "correctness", label: "Correctness", color: "warn" }],
    findings: [
      {
        id: "inert-catch-all",
        section: "correctness",
        path: "lib/error.rb",
        line: 12,
        kind: "bug",
        color: "critical",
        blocking: true,
        body: "The rescue clause now parses and never matches.",
      },
      {
        id: "spec-cannot-fail",
        section: "correctness",
        path: "spec/error_spec.rb",
        line: 40,
        kind: "question",
        body: "This spec asserts nothing that could fail.",
      },
    ],
    comment: "Two things worth a look before this goes in.",
    ...overrides,
  };
}

/**
 * A pull request as a destination would report it.
 *
 * @param {object} [overrides] fields to change
 * @returns {object} a queue entry
 */
export function aPull(overrides = {}) {
  return {
    owner: "org",
    repo: "app",
    number: 42,
    title: "Re-root the errors onto a common base class",
    author: "someone",
    url: "https://github.com/org/app/pull/42",
    updatedAt: "2026-07-29T15:00:00Z",
    createdAt: "2026-07-28T09:00:00Z",
    ...overrides,
  };
}

/**
 * Wire up an app against a reader that keeps nothing.
 *
 * @param {object} [options] how to build it
 * @param {object} [options.adapter] a reader to share with another app
 * @param {string} [options.deviceId] which device this is
 * @returns {Promise<object>} the app, its adapter, and its source
 */
export async function anApp({ adapter = new MemoryAdapter(), deviceId = "device-a" } = {}) {
  const state = new MultiEventStore({
    runners,
    database: () => new MemoryKeyValueStore(),
  });

  const drafts = new Drafts({ adapter });
  const queries = new Queries({ state, drafts });
  const sync = new Sync({ state, adapterFor: () => adapter, deviceId });
  const commands = new Commands({ state, queries, sync });

  const source = await commands.addSource({
    name: "Work",
    adapter: adapter.config(),
  });

  return {
    state,
    drafts,
    queries,
    commands,
    sync,
    adapter,
    source,

    /**
     * What the reader would be looking at for one pull request.
     *
     * @param {object} [pull] the pull request
     * @returns {object} the pull request with its draft and decisions
     */
    open(pull = aPull()) {
      return queries.pullState(source, pull);
    },
  };
}

/**
 * The whole app, wired the way the browser wires it.
 *
 * Only two things are stand-ins: the reader, which keeps nothing, and the
 * destination, which answers from memory. The store, the runners, the commands,
 * the queries and the drafts projection are the app's own.
 *
 * @param {object} [options] what to build it against
 * @param {object} [options.adapter] a reader to share with another app
 * @param {object[]} [options.pulls] what the destination says is waiting
 * @param {(name: string) => object} [options.database] local storage, for a test
 *   that cares when a write lands
 * @param {(message: string, tone: string) => void} [options.report] how the app
 *   tells the reader something, standing in for the footer
 * @param {object} [options.destination] destination methods to lay over the
 *   stubs, for a test that watches or breaks one
 * @returns {Promise<object>} the app, booted, with a destination and a source
 */
export async function theApp({
  adapter = new MemoryAdapter(),
  pulls = [aPull()],
  database = () => new MemoryKeyValueStore(),
  report,
  destination = {},
} = {}) {
  const app = new App({
    database,
    report,
    adapter: () => adapter,
    destination: () => ({
      identify: async () => ({ login: "reader" }),
      queue: async () => pulls,
      files: async () => [],
      headCommit: async () => "e612b1b",
      issue: async () => ({ body: "", title: "", isPull: false, url: "" }),
      patchDescription: async () => ({ url: "" }),
      commentOnIssue: async () => ({ url: "" }),
      closeIssue: async () => ({ url: "" }),
      emptyQueueHint: () => "",
      ...destination,
    }),
  });

  await app.boot();
  await app.addDestination({ type: "github", label: "GitHub", secret: { token: "t" } });
  await app.addSource({ name: "Work", adapter: { type: "memory" } });

  return app;
}

/**
 * Put a draft where an agent would have put it.
 *
 * @param {object} adapter the reader
 * @param {object} draft the draft
 * @returns {Promise<void>} when it is written
 */
export async function agentWrites(adapter, draft) {
  const path = `drafts/${draft.owner}--${draft.repo}-${draft.number}/review.json`;

  await adapter.write(path, new TextEncoder().encode(JSON.stringify(draft, null, 2)));
}
