// Picking something to look at, on mobile.
//
// The left pane opens as a drawer over the content on mobile - see
// rail.js/togglePaneCollapsed and the "menu drawer" comments in
// web/index.html. Picking anything inside it (a section, a theme, a file, a
// tab) is the reader saying what they want to look at next, and the drawer
// has to get out of the way to show it. Meaningless at desktop width, where
// the pane never collapses to begin with.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { theApp, aDraft, agentWrites } from "../use-cases/helper.js";

async function reading() {
  const adapter = new MemoryAdapter();
  await agentWrites(adapter, aDraft());

  const app = await theApp({ adapter });
  await app.select(app.queue()[0]);
  app.paneCollapsed = false;

  return app;
}

describe("showing a pane", () => {
  test("closes the mobile pane drawer, whichever tab is chosen", async () => {
    const app = await reading();

    app.show("diff", { path: "src/api/orders.js" });

    assert.equal(app.paneCollapsed, true);
  });

  test("closes it even choosing the tab already open", async () => {
    const app = await reading();

    app.show("summary");

    assert.equal(app.paneCollapsed, true);
  });

  test("closes it on the second click that clears a filter, same as the first that set it", async () => {
    const app = await reading();
    app.show("summary", { kind: "robustness" });
    app.paneCollapsed = false;

    app.show("summary", { kind: "robustness" });

    assert.equal(app.paneCollapsed, true);
  });
});
