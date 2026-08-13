// The application object.
//
// Everything the interface does goes through one of three things hanging off
// here: `queries` to read, `commands` to decide, and the methods on this object
// for the parts that are neither, like which pane is open or which pull request
// is being looked at. Keeping those three apart is what stops view code from
// quietly becoming the place business rules live.
//
// Nothing in here renders. The view subscribes and redraws.

import { MultiEventStore } from "../state/multi-event-store.js";
import { IndexedDBKeyValueStore } from "../state/key-value-store.js";
import { Drafts } from "../state/drafts.js";
import { probe } from "../state/health.js";
import { Sync, deviceIdFor } from "../state/sync.js";
import runners from "../state/runners.js";
import { Commands } from "../commands/index.js";
import { Queries } from "../queries/index.js";
import { buildAdapter, MemoryAdapter } from "../adapters/index.js";
import { recallHandle, rememberHandle, forgetHandle } from "../adapters/filesystem.js";
import { buildDestination } from "../destinations/index.js";
import { remember } from "./theirs.js";
import { syncWidget } from "./widget.js";

// How often the queue is asked for again. The destination is the slow, rate limited
// part of this app, and a review request does not arrive every second.
const REFRESH = 5 * 60 * 1000;

export class App {
  /**
   * @param {object} [options] what to build against, for tests
   * @param {(name: string) => object} [options.database] makes a local database
   * @param {object} [options.secrets] where secrets specifically are kept, in place of the config store - see MultiEventStore
   * @param {(config: object, secret: object, handle: object) => object} [options.adapter] makes a reader
   * @param {(destination: object, secret: object) => object} [options.destination] makes a destination
   * @param {(app: App) => Promise<void>} [options.install] attaches something on a browser that has nothing
   * @param {{remember: Function, recall: Function, forget: Function}} [options.handles] where directory handles are kept
   * @param {(message: string, tone: string) => void} [options.report] tells the reader something
   */
  constructor({ database, secrets, adapter, destination, install, handles, report } = {}) {
    this._buildAdapterWith = adapter || buildAdapter;
    this._buildDestinationWith = destination || buildDestination;
    this._install = install || null;

    // Almost everything the reader is told is told by the view, which is
    // watching. This is for the one thing the view cannot see: a source that
    // has quietly stopped answering, which arrives from the watch rather than
    // from anything the reader did.
    this._report = report || (() => {});

    // The handle store is its own database, apart from the event log, so it
    // fails on its own terms and a test has to be able to break it on its own.
    this._handles = handles || {
      remember: rememberHandle,
      recall: recallHandle,
      forget: forgetHandle,
    };

    this.state = new MultiEventStore({
      runners,
      database: database || ((name) => new IndexedDBKeyValueStore(name)),
      secrets,
    });

    this.drafts = null;
    this.adapter = null;
    this.destination = null;

    // How each source is doing, by id, from the last sweep. Kept beside the
    // sources rather than on them because it is an observation about storage,
    // not something the log records: it is true of this moment and this device.
    this.health = {};

    // Two more observations the sweep gathers, so the settings pane can draw
    // synchronously: the remembered folder's name for each browser-folder
    // source (the handle API hides the path), and how many of this reader's
    // decisions have not yet landed in each source's storage. That count is
    // null for a source whose count could not be read, which is a third answer
    // and not a quiet zero.
    this.handleNames = {};
    this.unsyncedCounts = {};

    this.queries = new Queries({ state: this.state, drafts: { find: () => null, problem: () => "" } });
    this.commands = new Commands({ state: this.state, queries: this.queries });

    // What is being looked at. None of it is worth a history, so none of it is
    // an event: reopening the app on the queue rather than where you left off
    // is the correct behaviour, not a limitation.
    this.source = null;
    this.login = "";
    this.pulls = [];
    this.selected = null;
    this.files = [];
    this.headCommit = "";

    // Why the diff or the head commit is missing, when they were asked for and
    // did not come. Kept apart from `problems` because it belongs to the pull
    // request that is open rather than to the source or the destination, and is
    // dropped the moment a different one is.
    this.diffProblem = "";
    this.filter = { section: "", kind: "", path: "" };
    this.tab = "summary";

    // A dismissal the reader has picked in the footer but not yet committed.
    // It lives here rather than with the rest of the view's half-written state
    // because it is a decision about the pull request that is open, so it has
    // to be dropped the moment a different one is.
    this.dismissing = false;

    // Kept apart by where they came from. A source opening cleanly says
    // nothing about whether the destination's token is any good, so one clearing its
    // own complaint must not clear the other's.
    this.problems = { source: "", destination: "" };

    this._listeners = new Set();
    this._stopWatching = [];
    this._refresh = null;
  }

  // ---- Starting up

  /**
   * Bring the app back to where it was.
   *
   * @returns {Promise<void>} when the interface has something to draw
   */
  async boot() {
    await this.commands.restore();

    // Anything that attaches itself does so here: after the log is back, so it
    // can see whether this browser already has a source, and before the source
    // and destination are opened, so what it attached is what opens.
    if (this._install) await this._install(this);

    this.deviceId = await deviceIdFor(this.state);
    this.commands.sync = new Sync({
      state: this.state,
      adapterFor: () => this.adapter,
      deviceId: this.deviceId,
    });

    await this._openDestination(await this.state.preference("destination"));
    await this._openSource(await this.state.preference("source"));

    this.changed();

    await this.probeSources();
  }

  /**
   * Look at every source, not just the one being read.
   *
   * Swept on boot and after a source is attached, edited or forgotten, which is
   * every moment the answer can have changed. Deliberately not on a timer: this
   * lists each source's drafts, and a settings pane left open should not be a
   * standing charge against someone's bucket.
   *
   * @returns {Promise<void>} when every source has been looked at
   */
  async probeSources() {
    const sources = this.queries.allSources();
    const health = {};
    const names = {};
    const counts = {};

    await Promise.all(
      sources.map(async (source) => {
        const open = this.source && this.source.id === source.id;

        if (source.adapter.type === "filesystem") {
          // Only the folder's name, for a row that has nowhere to put a reason.
          // The health probe below asks the same store and reports what it says.
          names[source.id] = (await this._handles.recall(source.id).catch(() => null))?.name || "";
        }

        // Null is "could not be counted", and it is deliberately not zero. This
        // count is the only durable record that a push did not land: a push
        // that fails answers false and leaves the mark where it was precisely
        // so this stays honest. Answering zero because the read of it failed
        // takes decisions that exist nowhere but this browser and reports them
        // to the reader as saved.
        counts[source.id] = this.commands.sync
          ? await this.commands.sync.unsynced(source).catch(() => null)
          : 0;

        // The open source has already said what is wrong with it, and when it
        // could not be built at all what is standing in for it is a reader that
        // keeps nothing. Probing that would report an empty source rather than
        // a broken one.
        if (open && this.problems.source) {
          health[source.id] = {
            state: "broken",
            reason: this.problems.source,
            drafts: 0,
            at: Date.now(),
          };

          return;
        }

        try {
          // The open source already has a built reader, and building a second
          // one would mean a second folder handle and a second seed fetch.
          const adapter = open && this.adapter ? this.adapter : await this._readerFor(source);

          health[source.id] = await probe(adapter);
        } catch (error) {
          // One source that cannot even be built is one broken row, not a
          // sweep that reports nothing about the others.
          health[source.id] = { state: "broken", reason: error.message, drafts: 0, at: Date.now() };
        }
      }),
    );

    this.health = health;
    this.handleNames = names;
    this.unsyncedCounts = counts;
    this.changed();
  }

  /**
   * How a source is doing, as of the last sweep.
   *
   * @param {object} source which source
   * @returns {{state: string, reason: string, drafts: number, at: number}|null} the record, or null before it has been looked at
   */
  healthOf(source) {
    return (source && this.health[source.id]) || null;
  }

  /**
   * What is currently wrong, if anything is.
   *
   * @returns {string} something to show the reader, or an empty string
   */
  get problem() {
    return this.problems.destination || this.problems.source;
  }

  /**
   * Tell the interface something moved.
   *
   * @param {() => void} listener what to call
   * @returns {() => void} stop listening
   */
  onChange(listener) {
    this._listeners.add(listener);

    return () => this._listeners.delete(listener);
  }

  /**
   * @returns {void}
   */
  changed() {
    this._listeners.forEach((listener) => listener());
  }

  // ---- Sources

  /**
   * Read a different source.
   *
   * @param {object|null} source which one, or null for none
   * @returns {Promise<void>} when its drafts are being read
   */
  async switchSource(source) {
    // The settings panel's rows both show a source and read from it, and the
    // row it opens on is the one already open. Clicking that is not a switch,
    // and reopening it would close the pull request the reader is reading.
    if (source && this.source && this.source.id === source.id) return;

    await this.state.setPreference("source", source ? source.id : null);
    await this._openSource(source ? source.id : null);

    this.selected = null;
    this.changed();
  }

  /**
   * Attach storage as a new source.
   *
   * @param {{name: string, adapter: object, secret?: object, handle?: object}} setup what to attach
   * @returns {Promise<object>} the source
   * @throws {Error} if the folder that was chosen could not be kept
   */
  async addSource(setup) {
    const source = await this.commands.addSource(
      { name: setup.name, adapter: setup.adapter },
      setup.secret,
    );

    // A directory handle cannot be serialised into the log, so it is kept
    // beside it, structured cloned, and asked for again on return. The id it is
    // kept under is the log's, which is why this cannot happen first.
    if (setup.handle) {
      try {
        await this._handles.remember(source.id, setup.handle);
      } catch (failure) {
        // The folder is the whole of a source that has one. Keeping a source
        // whose folder was never stored leaves the reader with a row that says
        // no folder was chosen, which is a full disk reported as forgetfulness.
        //
        // Taking it back out is best effort: storage that has just refused one
        // write can refuse this one, and the failure worth reporting is the
        // first one either way.
        await this.commands.removeSource(source).catch(() => {});

        throw new Error(
          `This browser could not keep the folder you chose, so the source was not attached: ${failure.message}`,
        );
      }
    }

    // The reader has brought their own storage, so the root of this origin is
    // no longer a pitch for them. Marked here rather than in the command
    // underneath, because the demo reaches that command directly and a visitor
    // to the homepage has chosen nothing.
    remember(globalThis.localStorage);

    await this.switchSource(source);
    await this.probeSources();

    return source;
  }

  /**
   * Change a source that is already attached.
   *
   * The source keeps its id, so everything recorded against it survives the
   * edit. That is deliberate even when the configuration now points somewhere
   * else: the decisions are the reader's, about pull requests, and a corrected
   * bucket name is the same reading of the same work. They travel with the
   * reader, and the next write pushes them to wherever it now points.
   *
   * Nothing is saved until the new configuration has been shown to work, so a
   * typo cannot leave a source that silently returns nothing.
   *
   * @param {object} source which source
   * @param {{name?: string, adapter?: object, secret?: object, handle?: object}} changes what to change
   * @returns {Promise<void>} when it is saved and reopened
   * @throws {Error} if the new configuration cannot be reached
   */
  async editSource(source, changes) {
    if (changes.adapter || changes.secret || changes.handle) {
      const config = changes.adapter || source.adapter;
      const secret = { ...(await this.state.secret(source.id)) };

      for (const [key, value] of Object.entries(changes.secret || {})) {
        if (value !== "" && value !== null && value !== undefined) secret[key] = value;
      }

      const handle = changes.handle || (await this._handleFor(source.id));
      const candidate = this._buildAdapterWith(config, secret, handle);
      const ready = await candidate.ready();

      if (!ready.ok) throw new Error(ready.reason);

      if (changes.handle) await rememberHandle(source.id, changes.handle);

      await this.commands.configureSource(source, config);
      await this.commands.mergeSecret(source.id, changes.secret);
    }

    if (changes.name) this.commands.renameSource(source, changes.name);

    // Reopening rebuilds the reader, so an edit takes effect without a reload.
    if (this.source && this.source.id === source.id) await this._openSource(source.id);

    this.changed();

    await this.probeSources();
  }

  /**
   * Which of a source's credentials are set, without handing any of them back.
   *
   * The interface needs to show that a key is stored so the reader knows an
   * empty box means "unchanged". It does not need the key, and putting one in
   * the page would undo the reason it is kept out of the log.
   *
   * @param {object} source which source
   * @returns {Promise<object>} each stored key mapped to true
   */
  async secretsSetFor(source) {
    const secret = await this.state.secret(source.id);

    return Object.fromEntries(
      Object.entries(secret)
        .filter(([, value]) => value !== "" && value !== null && value !== undefined)
        .map(([key]) => [key, true]),
    );
  }

  /**
   * How many of the reader's decisions have not reached a source's storage.
   *
   * Here rather than on `queries`, which is synchronous and answers only from
   * the event log. This is a fact about a write that did not land, kept beside
   * the log rather than in it, which is the same shape as `secretsSetFor`.
   *
   * @param {object} source which source
   * @returns {Promise<number>} how many are waiting, 0 when everything landed
   */
  unsyncedFor(source) {
    return this.commands.sync.unsynced(source);
  }

  /**
   * Forget a source. Nothing is deleted from the customer's storage.
   *
   * @param {object} source which one
   * @returns {Promise<void>} when it is gone from here
   */
  async removeSource(source) {
    const wasOpen = this.source && this.source.id === source.id;

    // Clearing what was kept on this machine is a courtesy, not a precondition.
    // It is all cache, and it is kept somewhere that may not be reachable at
    // all, so failing to clear it must not be what stops a source being
    // removed. The read side already treats it this way.
    //
    // The adapter's own copy matters more than the handle does. A git source
    // holds a whole clone of the customer's repository, and removing the source
    // while leaving that on disk would be a delete that deleted nothing.
    await this._handles.forget(source.id).catch(() => {});
    await this._readerFor(source)
      .then((adapter) => adapter.forget())
      .catch(() => {});
    await this.commands.removeSource(source);

    if (wasOpen) await this.switchSource(this.queries.allSources()[0] || null);

    this.changed();

    await this.probeSources();
  }

  // ---- Destinations

  /**
   * Post with a different account or host.
   *
   * @param {object|null} destination which one
   * @returns {Promise<void>} when it has said who it is
   */
  async switchDestination(destination) {
    await this.state.setPreference("destination", destination ? destination.id : null);
    await this._openDestination(destination ? destination.id : null);
    await this.loadQueue();
  }

  /**
   * Add somewhere reviews can be posted.
   *
   * @param {{type: string, label: string, secret: object}} setup the destination
   * @returns {Promise<object>} the destination
   */
  async addDestination(setup) {
    const destination = await this.commands.addDestination(
      { type: setup.type, label: setup.label },
      setup.secret,
    );

    // Same as attaching a source: somewhere to send a review is a decision the
    // reader made, and the demo does not make it through here.
    remember(globalThis.localStorage);

    await this.switchDestination(destination);

    return destination;
  }

  /**
   * Change a destination that is already configured.
   *
   * A rotated token is the same destination with a new key, so the destination
   * keeps its id and nothing recorded against it is disturbed. The new
   * credential is checked before it is stored, because a token that does not
   * work reads as an empty queue rather than as an error.
   *
   * @param {object} destination which destination
   * @param {{label?: string, secret?: object}} changes what to change
   * @returns {Promise<void>} when it is saved
   * @throws {Error} if the new credential is refused
   */
  async editDestination(destination, changes) {
    if (changes.secret) {
      const secret = { ...(await this.state.secret(destination.id)) };

      for (const [key, value] of Object.entries(changes.secret)) {
        if (value !== "" && value !== null && value !== undefined) secret[key] = value;
      }

      await this._buildDestinationWith(destination, secret).identify();
      await this.commands.recredentialDestination(destination, changes.secret);
    }

    if (changes.label) this.commands.renameDestination(destination, changes.label);

    if (this.destinationId === destination.id) await this._openDestination(destination.id);

    this.changed();
  }

  /**
   * @param {object} destination which one
   * @returns {Promise<void>} when it and its token are gone
   */
  async removeDestination(destination) {
    const wasOpen = this.destination && this.destinationId === destination.id;

    await this.commands.removeDestination(destination);

    if (wasOpen) await this.switchDestination(this.queries.allDestinations()[0] || null);

    this.changed();
  }

  // ---- The queue

  /**
   * Ask the destination what is waiting.
   *
   * @returns {Promise<void>} when the queue is current
   */
  async loadQueue() {
    if (!this.destination) {
      this.pulls = [];
      this.changed();
      await syncWidget(0);

      return;
    }

    try {
      this.pulls = await this.destination.queue();
      this.problems.destination = "";
    } catch (error) {
      this.problems.destination = error.message;
    }

    // Reading the drafts for the queue is what makes a pull request show as
    // ready before it has been opened.
    if (this.drafts) await this.drafts.loadAll();

    // That read can have cleared the very review being looked at, so this ends
    // the way the watch does. Redrawing alone would leave the queue saying the
    // review is gone while the pane went on showing it.
    await this.reselect();
    await syncWidget(this.queue().length);
  }

  /**
   * Ask again, on the timer, with nobody holding the answer.
   *
   * `loadQueue` throws, because every other caller awaits it and can say what
   * went wrong. A timer's callback cannot: what it returns is discarded, so
   * anything thrown out of here would be an unhandled rejection and the reader
   * would be told nothing at all. The reason is left on the source instead, in
   * the same words and the same shape the sweep uses, so it shows on the
   * source's row and its attention dot rather than in a console nobody opens.
   *
   * @returns {Promise<void>} when the queue is current, or the source says why not
   */
  async refreshQueue() {
    try {
      await this.loadQueue();
    } catch (failure) {
      this.problems.source = failure.message;

      if (this.source) {
        this.health[this.source.id] = {
          state: "broken",
          reason: failure.message,
          drafts: 0,
          at: Date.now(),
        };
      }

      this.changed();
    }
  }

  /**
   * The queue as it should be shown.
   *
   * @returns {object[]} the pull requests to list
   */
  queue() {
    if (!this.source) return [];

    return this.queries.queue(this.source, this.pulls);
  }

  /**
   * The pull requests taken off the queue, so they can be put back.
   *
   * @returns {object[]} the dismissed ones
   */
  dismissed() {
    if (!this.source) return [];

    return this.queries.dismissed(this.source, this.pulls);
  }

  /**
   * Open a pull request.
   *
   * @param {object} pull one entry from the queue
   * @returns {Promise<void>} when its draft and diff are in
   */
  async select(pull) {
    this.selected = pull;
    this.files = [];
    this.headCommit = "";
    this.diffProblem = "";
    this.filter = { section: "", kind: "", path: "" };
    this.tab = "summary";
    this.dismissing = false;
    this.changed();

    if (this.drafts) await this.drafts.load(pull, pull.key);

    this.selected = this.queries.pullState(this.source, pull);
    this.changed();

    if (!this.destination) return;

    // The diff and the head commit are wanted but not required: a draft is
    // readable without them, and a destination that is rate limiting should not
    // stop the reader reading.
    const [files, commit] = await Promise.allSettled([
      this.destination.files(pull),
      this.destination.headCommit(pull),
    ]);

    if (files.status === "fulfilled") this.files = files.value;
    if (commit.status === "fulfilled") this.headCommit = commit.value;

    // Not thrown, for the reason above, but not swallowed either. A diff that
    // could not be fetched draws exactly like a pull request that changed no
    // files, so silence here reads as a fact about the pull request rather than
    // about the connection. The head commit is worth saying even when the diff
    // arrived: posting a finding fetches it again, and the reader should not
    // first learn the destination is refusing at the moment they press post.
    const refused = [files, commit].find((answer) => answer.status === "rejected");

    this.diffProblem = refused
      ? refused.reason?.message || "the destination did not say why"
      : "";

    this.changed();
  }

  /**
   * Throw away the draft on the pull request that is open, so it is reviewed
   * again.
   *
   * Nothing is started by this. The agent claims work by looking for a pull
   * request with no draft, so what the reader gets is a place in that queue,
   * not a review beginning now.
   *
   * @returns {Promise<void>} when the draft is gone
   * @throws {Error} carrying the reader's message when the storage refuses
   */
  async clearDraft() {
    const pull = this.selected;

    if (!pull || !this.drafts || !pull.draft) return;

    await this.drafts.clear(pull, pull.key);

    // A review already posted for this pull request described the draft
    // just thrown away, not whatever the agent writes next - so it stops
    // counting as posted the moment a fresh one is asked for, rather than
    // staying locked until the new draft happens to finish.
    if (this.queries.isPosted(this.source, pull)) {
      this.commands.forgetPost(this.source, pull);
    }

    await this.reselect();
  }

  /**
   * Look again at the pull request that is open.
   *
   * This is what a watcher calls when the storage moved underneath the reader,
   * and what every decision taken while reading calls once it is recorded. The
   * recompute is only possible when something is open, but the redraw is owed
   * either way, because the queue is drawn from that same storage: a draft
   * landing while nothing is open is exactly the moment the queue has to say so.
   *
   * The redraw waits for the log's outstanding writes. It is the redraw that
   * tells the reader a decision was taken, so a reader who reads that and
   * closes the tab has to find it still true. The recompute does not wait,
   * because reading back what was just decided never has to.
   *
   * @returns {Promise<void>} when the interface has been told
   */
  async reselect() {
    if (this.selected && this.source) {
      this.selected = this.queries.pullState(this.source, this.selected);
    }

    await this.state.settled();

    this.changed();
  }

  // ---- Posting

  /**
   * Send one comment on its own, ahead of the review.
   *
   * @param {object} finding which finding
   * @returns {Promise<void>} when it is up, and recorded
   * @throws {Error} carrying the destination's message when it will not take it
   */
  async postFinding(finding) {
    const pull = this.selected;
    const commitId = this.headCommit || (await this.destination.headCommit(pull));

    const posted = await this.destination.comment(pull, {
      commitId,
      path: finding.path,
      line: finding.line,
      body: this.queries.bodyToPost(this.source, finding),
    });

    this.commands.recordPostedFinding(this.source, pull, finding, posted);
    await this.reselect();
  }

  /**
   * Send the review.
   *
   * @param {object} payload a body from reviewPayload
   * @returns {Promise<{url: string}>} where it landed
   * @throws {Error} carrying the destination's message when it will not take it
   */
  async postReview(payload) {
    const pull = this.selected;
    const posted = await this.destination.review(pull, payload);

    // Waited for: a review that went out and was not recorded as sent comes
    // back on the queue looking unposted, and the reader posts it twice.
    await this.commands.recordPostedReview(this.source, pull, {
      url: posted.url,
      event: payload.event,
    });
    await this.reselect();

    return posted;
  }

  // ---- Filters and panes, which are neither reads nor decisions

  /**
   * Show a pane, optionally filtered.
   *
   * A second click on the filter that is already on clears it, because a
   * filter with no way out is a trap.
   *
   * @param {string} tab which pane
   * @param {object} [filter] what to filter by
   * @returns {void}
   */
  show(tab, filter = {}) {
    const same = Object.entries(filter).every(([key, value]) => this.filter[key] === value);

    this.tab = tab;
    this.filter = same && Object.keys(filter).length
      ? { section: "", kind: "", path: "" }
      : { section: "", kind: "", path: "", ...filter };

    // Meaningless at desktop width, where the pane never collapses in the
    // first place - but on mobile, picking something in it is the reader
    // saying what they want to look at next, and the drawer is now in the
    // way of looking at it.
    this.paneCollapsed = true;

    this.changed();
  }

  // ---- Wiring

  async _openSource(id) {
    this._stopWatching.forEach((stop) => stop());
    this._stopWatching = [];

    this.source = id ? this.queries.findSource(id) : null;

    if (!this.source) {
      this.source = this.queries.allSources()[0] || null;
    }

    if (!this.source) {
      this.adapter = null;
      this.drafts = null;

      return;
    }

    this.problems.source = "";
    this.adapter = await this._buildAdapter(this.source);
    this.drafts = new Drafts({ adapter: this.adapter });
    this.queries.drafts = this.drafts;

    const ready = await this.adapter.ready();

    // A reader that could not be built has already said why, and it is standing
    // in for the real one. Asking the stand-in whether it is ready would answer
    // yes and throw away the only explanation the reader is going to get.
    if (!this.problems.source) this.problems.source = ready.ok ? "" : ready.reason;

    if (this.problems.source) return;

    await this.drafts.loadAll();

    // Every source needs a top-level drafts/ directory - it is where every
    // adapter is told to read and write - and forgetting to nest an agent's
    // files under it is indistinguishable, from the listing alone, from a
    // source nobody has written to yet. This is the one case worth naming,
    // since it is the mistake a reader hits before ever seeing a draft.
    if (!this.problems.source && this.drafts.misconfigured) {
      this.problems.source =
        "no drafts/ directory found - every source needs one at the top level; " +
        "put review.json under drafts/<owner>--<repo>-<number>/ rather than at the source root";
    }

    // Once a source is open, the watch below is the only thing still asking it
    // anything: health is swept on boot and deliberately never on a timer. So a
    // source that stops answering after it opened is noticed here or nowhere,
    // and a reader nobody tells goes on reviewing a queue that stopped moving.
    this.adapter.onTrouble = ({ ok, reason }) =>
      this._report(
        ok ? "this source is answering again" : `this source has stopped answering: ${reason}`,
        ok ? "ok" : "error",
      );

    // The reader watches its own storage for both things it holds: the agent's
    // drafts, and the decisions this reader's other devices have made. Either
    // moving means the open review is no longer what this app is holding, so
    // both are answered the same way rather than one merely redrawing.
    this._stopWatching.push(this.drafts.watch(() => this.reselect()));
    this._stopWatching.push(
      this.commands.sync.watch(this.source, () => this.reselect()),
    );

    // A first pull that could not reach the storage loses nothing: this device
    // has its own decisions either way, and the watch below asks again in two
    // seconds. Stopping here would mean a source that opens into nothing
    // because another device's log was briefly unreadable.
    await this.commands.sync.pull(this.source).catch(() => {});
    await this.loadQueue();

    clearInterval(this._refresh);
    this._refresh = setInterval(() => this.refreshQueue(), REFRESH);
    // Asking the destination again must never be the reason a process stays alive.
    if (typeof this._refresh.unref === "function") this._refresh.unref();
  }

  /**
   * A reader for a source, as configured.
   *
   * @param {object} source which source
   * @returns {Promise<object>} the reader
   * @throws {Error} if it cannot be built from what is stored
   */
  async _readerFor(source) {
    const secret = await this.state.secret(source.id);
    const handle = await this._handleFor(source.id);

    return this._buildAdapterWith(source.adapter, secret, handle);
  }

  // A folder that was never kept is nothing; a handle store that could not be
  // read is the failure itself. The reader is handed whichever it was and says
  // which, because the two are not the same news and only one of them is the
  // reader's own doing.
  //
  // A store that hangs rather than failing is not caught here, and cannot be:
  // there is nothing to catch until it answers.
  _handleFor(id) {
    return this._handles.recall(id).catch((failure) => failure);
  }

  async _buildAdapter(source) {
    try {
      return await this._readerFor(source);
    } catch (error) {
      this.problems.source = error.message;

      // Something coherent to render beats a blank pane. A source whose
      // reader cannot be built shows as empty rather than as broken chrome.
      return new MemoryAdapter();
    }
  }

  async _openDestination(id) {
    const destination = id ? this.queries.findDestination(id) : this.queries.allDestinations()[0];

    this.destinationId = destination ? destination.id : null;
    this.destination = null;
    this.login = "";
    this.problems.destination = "";

    if (!destination) return;

    try {
      this.destination = this._buildDestinationWith(destination, await this.state.secret(destination.id));
      this.login = (await this.destination.identify()).login;
    } catch (error) {
      this.problems.destination = error.message;
      this.destination = null;
    }
  }
}
