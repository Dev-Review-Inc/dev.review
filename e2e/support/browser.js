// A browser, driven over the wire.
//
// This is the whole of the dependency the end to end suite takes: Chrome, which
// is already on the machine, spoken to over the DevTools protocol with the
// WebSocket node has built in. No package, no second copy of a browser, nothing
// to install before a commit can be made.
//
// It is deliberately small. Only what the journeys need is here: open a page,
// click something, type into something, read the page back, and notice when the
// page complains. Anything more would be a test framework, and a test framework
// is the thing that was not worth the cost.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Where Chrome is, in the order worth looking. The channel does not matter:
// the protocol this speaks has been stable across all of them for years.
const CHROMES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

// How long to wait for a condition on the page before calling it a failure.
//
// The loop below asks every 20ms and returns the moment the answer is yes, so
// this budget is only ever spent on a run that was going to fail anyway. That
// makes a generous ceiling free on the happy path and a tight one actively
// harmful: at 5000ms a two-core CI runner, doing rather more work than a
// laptop, failed here on timing alone and reported a red build that meant
// nothing. Long enough to outlast a loaded machine, short enough that a real
// hang is still reported as one rather than sitting there forever.
const PATIENCE = 30000;

/**
 * Start a headless browser.
 *
 * @returns {Promise<object>} the browser, with `context()` and `stop()`
 * @throws {Error} if no Chrome can be found or it will not start
 */
export async function openBrowser() {
  const binary = await firstThatExists();
  const profile = await mkdtemp(join(tmpdir(), "reviewer-e2e-"));

  const chrome = spawn(binary, [
    "--headless=new",
    // Port zero, so a suite running beside another agent's browser cannot
    // collide with it. Chrome prints the port it chose.
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-gpu",
    "--window-size=1400,900",
    "about:blank",
  ]);

  const endpoint = await devtoolsEndpoint(chrome);
  const socket = await connect(endpoint);

  const browser = {
    /**
     * A page in storage of its own.
     *
     * Every journey gets one, so nothing a test writes into IndexedDB or local
     * storage can reach the next test. A context is a bookkeeping entry inside
     * the browser that is already running, not a second browser, so this costs
     * milliseconds rather than the launch.
     *
     * @param {string} url where to start
     * @returns {Promise<object>} the page
     */
    async page(url) {
      const { browserContextId } = await socket.send("Target.createBrowserContext");
      const { targetId } = await socket.send("Target.createTarget", {
        url: "about:blank",
        browserContextId,
      });

      return openPage(socket, targetId, browserContextId, url);
    },

    async stop() {
      await socket.close();

      // The profile can only go once Chrome has let go of it.
      const ended = new Promise((resolve) => chrome.on("exit", resolve));

      chrome.kill();
      await ended;
      await rm(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };

  return browser;
}

async function firstThatExists() {
  const { access } = await import("node:fs/promises");

  for (const candidate of CHROMES) {
    try {
      await access(candidate);

      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    `no Chrome found. Looked in:\n  ${CHROMES.join("\n  ")}\nSet CHROME_PATH to point at one.`,
  );
}

function devtoolsEndpoint(chrome) {
  return new Promise((resolve, reject) => {
    let said = "";

    const timer = setTimeout(
      () => reject(new Error(`Chrome did not report a debugging port. It said:\n${said}`)),
      15000,
    );

    chrome.stderr.on("data", (chunk) => {
      said += chunk;

      const found = said.match(/ws:\/\/[^\s]+/);

      if (!found) return;

      clearTimeout(timer);
      resolve(found[0]);
    });

    chrome.on("error", reject);
    chrome.on("exit", (code) => reject(new Error(`Chrome exited with ${code}: ${said}`)));
  });
}

/**
 * One DevTools connection, multiplexed over every page on it.
 *
 * The protocol is request and response by id, with events arriving in between,
 * which is a promise per id and a listener list per session.
 */
async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  const waiting = new Map();
  const listeners = new Set();
  let next = 0;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("could not reach Chrome")), {
      once: true,
    });
  });

  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data);

    if (payload.id !== undefined) {
      const pending = waiting.get(payload.id);

      if (!pending) return;

      waiting.delete(payload.id);

      if (payload.error) pending.reject(new Error(payload.error.message));
      else pending.resolve(payload.result);

      return;
    }

    for (const listener of listeners) listener(payload);
  });

  return {
    send(method, params = {}, sessionId) {
      const id = (next += 1);

      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },

    on(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },

    close() {
      socket.close();
    },
  };
}

async function openPage(socket, targetId, browserContextId, url) {
  const { sessionId } = await socket.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => socket.send(method, params, sessionId);

  // Everything the page said that it should not have. Asserted on at the end of
  // a journey: an exception thrown out of a redraw leaves the interface looking
  // plausible and half drawn, and nothing else in a test would notice.
  const complaints = [];

  const stopListening = socket.on((payload) => {
    if (payload.sessionId !== sessionId) return;

    if (payload.method === "Runtime.exceptionThrown") {
      const detail = payload.params.exceptionDetails;

      complaints.push(detail.exception?.description || detail.text);
    }

    if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
      complaints.push(payload.params.args.map((arg) => arg.description || arg.value).join(" "));
    }
  });

  await send("Runtime.enable");
  await send("Page.enable");

  const page = {
    complaints,

    /**
     * Run this before the page's own code, on this load and every one after.
     *
     * @param {string} source a plain script, not a module
     * @returns {Promise<void>} when Chrome has it
     */
    async inject(source) {
      await send("Page.addScriptToEvaluateOnNewDocument", { source });
    },

    /**
     * @param {string} to where to go, defaulting to where the page started
     * @returns {Promise<void>} when the load event has fired
     */
    async go(to = url) {
      const landed = new Promise((resolve) => {
        const stop = socket.on((payload) => {
          if (payload.sessionId !== sessionId || payload.method !== "Page.loadEventFired") return;

          stop();
          resolve();
        });
      });

      await send("Page.navigate", { url: to });
      await landed;
    },

    /**
     * Evaluate an expression in the page and hand back what it answered.
     *
     * @param {string} expression javascript, awaited if it is a promise
     * @returns {Promise<any>} the value, structured cloned out of the page
     * @throws {Error} carrying the page's own message when it threw
     */
    async eval(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });

      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        );
      }

      return result.result.value;
    },

    /**
     * Wait until an expression is true of the page.
     *
     * @param {string} expression javascript that answers true when it is time
     * @param {string} [because] what was being waited for, for the failure message
     * @returns {Promise<void>} when it is true
     * @throws {Error} if it never becomes true
     */
    async until(expression, because = expression) {
      const deadline = Date.now() + PATIENCE;

      for (;;) {
        if (await page.eval(`Boolean(${expression})`)) return;

        if (Date.now() > deadline) {
          throw new Error(`waited ${PATIENCE}ms for ${because}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },

    /**
     * Click something, the way a mouse does.
     *
     * Dispatched as real input rather than as `element.click()`, so a handler
     * that only listens for a trusted event is exercised the same as one that
     * does not.
     *
     * @param {string} selector what to click
     * @returns {Promise<void>} when the click has been delivered
     * @throws {Error} if nothing matches, or it has no box to click
     */
    click(selector) {
      return page.clickWhere(`document.querySelector(${JSON.stringify(selector)})`, selector);
    },

    /**
     * Click the button with this label, inside this part of the page.
     *
     * The interface builds its cards in code and gives their buttons no ids, so
     * a test reaches them the way a reader does: by what they say.
     *
     * @param {string} scope a selector for where to look
     * @param {string} label the button's exact text
     * @returns {Promise<void>} when the click has been delivered
     */
    clickButton(scope, label) {
      const expression = `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})]
        .find((button) => button.textContent.trim() === ${JSON.stringify(label)})`;

      return page.clickWhere(expression, `the ${label} button in ${scope}`);
    },

    /**
     * @param {string} expression javascript answering with the element to click
     * @param {string} what what was being looked for, for the failure message
     * @returns {Promise<void>} when the click has been delivered
     * @throws {Error} if nothing was found, or it has no box to click
     */
    async clickWhere(expression, what) {
      const spot = await page.eval(`(() => {
        const element = ${expression};

        if (!element) return null;

        element.scrollIntoView({ block: "center" });

        const box = element.getBoundingClientRect();

        if (!box.width || !box.height) return null;

        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const on = document.elementFromPoint(x, y);

        // A click a reader could not have made is a failed test, not a passed
        // one: an open popover's backdrop over the button would otherwise
        // swallow the click and leave the assertion to time out somewhere else.
        return {
          x,
          y,
          covered: element.contains(on) ? "" : (on?.outerHTML || "nothing").slice(0, 120),
        };
      })()`);

      if (!spot) throw new Error(`nothing clickable at ${what}`);
      if (spot.covered) throw new Error(`${what} is covered by ${spot.covered}`);

      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type,
          x: spot.x,
          y: spot.y,
          button: "left",
          clickCount: 1,
        });
      }
    },

    /**
     * Type into a field, having put the cursor in it first.
     *
     * @param {string} selector the field
     * @param {string} text what to type
     * @returns {Promise<void>} when it is typed
     */
    async fill(selector, text) {
      await page.click(selector);
      await send("Input.insertText", { text });
    },

    /**
     * Choose an option in a select, which has no box a mouse can reach headless.
     *
     * @param {string} selector the select
     * @param {string} value the option's value
     * @returns {Promise<void>} when the change has been announced
     */
    async choose(selector, value) {
      await page.eval(`(() => {
        const select = document.querySelector(${JSON.stringify(selector)});
        select.value = ${JSON.stringify(value)};
        select.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
    },

    /**
     * @param {string} selector what to read
     * @returns {Promise<string>} its text, trimmed, or "" when it is not there
     */
    text(selector) {
      return page.eval(
        `(document.querySelector(${JSON.stringify(selector)})?.textContent || "").trim()`,
      );
    },

    /**
     * @param {string} selector what to count
     * @returns {Promise<number>} how many there are
     */
    count(selector) {
      return page.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    },

    async close() {
      stopListening();
      await socket.send("Target.closeTarget", { targetId });
      await socket.send("Target.disposeBrowserContext", { browserContextId });
    },
  };

  return page;
}
