// How each decision changes what the reader sees.
//
// Every one of these is a decision the reader made. Nothing the drafting agent
// wrote passes through here: the draft arrives from the adapter, is parsed, and
// is merged with these projections at query time. That is why an agent can
// rewrite its draft under the reader's feet without losing what they decided.
//
// State that changes over time is recorded as when it changed rather than as a
// flag, so "dropped in the last hour" and "dropped before the agent rewrote
// this" are answerable, and so the log reads as history rather than as a pile
// of booleans.

import { EventStore } from "./event-store.js";

/**
 * The object an event concerns, made if this is the first thing said about it.
 *
 * A drop can arrive before anything created the finding it drops - from another
 * device, or simply because the reader's decisions are the only records this
 * app keeps and there is no create for an agent's finding. Finding or making is
 * therefore the normal path, not the exceptional one.
 *
 * @param {object} state the projected state
 * @param {object} event the event being run
 * @returns {object} the object to change
 */
function at(state, event) {
  const collection = state[event.collection];
  const existing = collection.find((item) => item.id === event.objectId);

  if (existing) return existing;

  const made = { id: event.objectId, createdAt: event.time, _collection: event.collection };
  collection.push(made);

  return made;
}

/**
 * Record a moment against the object an event concerns.
 *
 * @param {string} field the timestamp field to set
 * @param {*} [value] what to set it to, defaulting to when the event happened
 * @returns {(event: object) => void} a runner
 */
function moment(field, value) {
  return function (event) {
    const object = at(this, event);

    object[field] = value === undefined ? event.time : value;
    object.updatedAt = event.time;
  };
}

/**
 * Record a payload against the object an event concerns.
 *
 * @param {(data: object, event: object) => object} shape what to merge in
 * @returns {(event: object) => void} a runner
 */
function change(shape) {
  return function (event) {
    const object = at(this, event);

    Object.assign(object, shape(event.data || {}, event));
    object.updatedAt = event.time;
  };
}

export default {
  // ---- The sources and destinations themselves, held in the root store.
  //
  // Neither carries a credential. An adapter's keys and a destination's token are
  // kept beside the log rather than in it, because the log is the thing that
  // syncs to storage the customer owns, and a token has no business travelling.

  "sources.create": EventStore.RUNNERS.CREATE,
  "sources.rename": change((data) => ({ name: data.name })),
  "sources.configure": change((data) => ({ adapter: data.adapter })),
  "sources.delete": EventStore.RUNNERS.DELETE,

  "destinations.create": EventStore.RUNNERS.CREATE,
  "destinations.rename": change((data) => ({ label: data.label, name: data.label })),
  "destinations.delete": EventStore.RUNNERS.DELETE,

  // ---- What the reader decided about a pull request as a whole.
  //
  // Keyed by "owner/repo#number", so a decision survives the draft being
  // rewritten, deleted, or never written in the first place.

  "pulls.dismiss": moment("dismissedAt"),
  "pulls.restore": moment("dismissedAt", null),

  // The review body. Null means the reader has not touched it and the agent's
  // own comment stands, which is not the same as the reader clearing it.
  "pulls.editComment": change((data, event) => ({
    comment: data.body,
    commentEditedAt: event.time,
  })),
  "pulls.resetComment": change(() => ({ comment: null, commentEditedAt: null })),

  "pulls.chooseVerdict": change((data) => ({ verdict: data.event })),

  // The ticket body. Null means the reader has not touched it and the kept
  // hunks decide what it says.
  "pulls.editDescription": change((data, event) => ({
    description: data.body,
    descriptionEditedAt: event.time,
  })),
  "pulls.resetDescription": change(() => ({ description: null, descriptionEditedAt: null })),

  // The proposed close, which the reader can leave out of the triage.
  "pulls.dropClose": moment("closeDroppedAt"),
  "pulls.restoreClose": moment("closeDroppedAt", null),

  "pulls.post": change((data, event) => ({
    postedAt: event.time,
    postedUrl: data.url || "",
    verdict: data.event,
  })),

  // ---- What the reader decided about one finding.
  //
  // Keyed by "owner/repo#number:findingId", so the agent's own stable ids are
  // what carry a decision across a redraft, exactly as the schema promises.

  "findings.drop": moment("droppedAt"),
  "findings.restore": moment("droppedAt", null),

  // ---- What the reader decided about one hunk of a proposed ticket body.
  //
  // Keyed by "owner/repo#number:hunkId", the differ's content-derived id, so a
  // rejection survives the agent redrafting around it.

  "hunks.reject": moment("rejectedAt"),
  "hunks.restore": moment("rejectedAt", null),

  "findings.editBody": change((data, event) => ({ body: data.body, editedAt: event.time })),
  "findings.resetBody": change(() => ({ body: null, editedAt: null })),

  "findings.post": change((data, event) => ({
    postedAt: event.time,
    postedUrl: data.url || "",
  })),

  // A comment the reader wrote themselves. This is a create because there is
  // no agent finding underneath it - the reader is the author, and the event
  // store gives it an id that cannot collide with another one on the same line.
  "findings.create": EventStore.RUNNERS.CREATE,
  "findings.delete": EventStore.RUNNERS.DELETE,

  // ---- How the reader is reading.
  //
  // A reading mode rather than a transient filter, so it survives a reload and
  // follows the reader to their other devices, as every other decision does.

  "preferences.flagOnly": moment("flaggedOnlyAt"),
  "preferences.showAll": moment("flaggedOnlyAt", null),

  // ---- How far through the diff the reader has got.

  "files.markViewed": moment("viewedAt"),
  "files.markUnviewed": moment("viewedAt", null),
  "files.collapse": moment("collapsedAt"),
  "files.expand": moment("collapsedAt", null),
};
