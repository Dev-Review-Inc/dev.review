// The interface, served the way it is served.
//
// The suite runs against serve/, not against a static server invented for the
// tests, because the content security policy that server sends is part of what
// the interface has to work under. A test page that no policy applied to would
// pass while the real one refused to start.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A port nobody is listening on.
 *
 * The server reports the address it was asked for rather than the one it got,
 * so it cannot be told to choose. Asking the operating system here instead is
 * what keeps the suite safe to run beside the reader's own copy, and beside
 * another agent's.
 *
 * @returns {Promise<number>} a free port
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();

      probe.close(() => resolve(port));
    });
  });
}

/**
 * Start the server.
 *
 * @returns {Promise<{origin: string, stop: () => void}>} where it is listening
 * @throws {Error} if it will not start
 */
export async function serveSite() {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;

  // Its own process group: `go run` compiles to a binary and runs it as a
  // child, so signalling the group is what actually stops the listener.
  const server = spawn("go", ["run", ".", "-dir", "../web", "-addr", `127.0.0.1:${port}`], {
    cwd: join(root, "serve"),
    detached: true,
  });

  let said = "";

  server.stderr.on("data", (chunk) => (said += chunk));
  server.stdout.on("data", (chunk) => (said += chunk));

  await answering(origin, server, () => said);

  return {
    origin,

    stop() {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    },
  };
}

async function answering(origin, server, said) {
  const deadline = Date.now() + 60000;

  for (;;) {
    if (server.exitCode !== null) {
      throw new Error(`serve exited with ${server.exitCode}: ${said()}`);
    }

    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(500) });

      if (response.ok) return;
    } catch {
      // Not up yet. The first run of `go run` compiles, which is not quick.
    }

    if (Date.now() > deadline) throw new Error(`serve never answered on ${origin}: ${said()}`);

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
