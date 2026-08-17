// The world the interface is dropped into, from inside the page.
//
// A classic script rather than a module: it is injected before anything else
// runs, so that by the time the interface asks for its storage or its
// destination, both are already answering.
//
// Only one thing is replaced, and it is the only thing that leaves the machine:
// `fetch`. Above it sit the real S3 adapter, the real signing, the real GitHub
// destination and the real interface, so what these journeys exercise is the
// app, not a rehearsal of it. Below it sits a Map. That is what makes the suite
// runnable in a commit hook: there is no token to hold, and nothing to reach.
//
// The seed is written in ahead of this file by the harness.

(() => {
  const seed = globalThis.__seed;
  const bucket = seed.bucket;

  // Object storage, as a Map of key to text.
  const objects = new Map(Object.entries(seed.objects));

  // The issues' live bodies, keyed "owner/repo#n". A Map rather than the seed
  // itself so a PATCH lands somewhere a later GET reads back, and so a test can
  // move a ticket underneath the reader.
  const issueBodies = new Map(Object.entries(seed.issueBodies || {}));

  // What the interface sent out, so a test can assert on what would have
  // reached GitHub rather than only on what the page then said.
  const sent = [];

  globalThis.__world = {
    objects,
    issueBodies,
    sent,

    /**
     * @param {string} key the object key
     * @param {string} body what it holds now
     * @returns {void}
     */
    put(key, body) {
      objects.set(key, body);
    },
  };

  const xml = (parts) => parts.join("");

  function escapeText(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function listing(prefix) {
    const contents = [...objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, body]) =>
        xml([
          "<Contents>",
          `<Key>${escapeText(key)}</Key>`,
          `<Size>${new TextEncoder().encode(body).length}</Size>`,
          "<LastModified>2026-07-29T15:41:10.000Z</LastModified>",
          `<ETag>&quot;${body.length}-${key.length}&quot;</ETag>`,
          "</Contents>",
        ]),
      );

    return xml([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
      `<Name>${bucket}</Name>`,
      `<Prefix>${escapeText(prefix)}</Prefix>`,
      "<IsTruncated>false</IsTruncated>",
      ...contents,
      "</ListBucketResult>",
    ]);
  }

  function storage(url, method, body) {
    const key = decodeURIComponent(url.pathname.replace(`/${bucket}/`, "").replace(`/${bucket}`, ""));

    if (method === "GET" && url.searchParams.get("list-type") === "2") {
      return new Response(listing(url.searchParams.get("prefix") || ""), {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }

    if (method === "GET") {
      const held = objects.get(key);

      return held === undefined
        ? new Response("", { status: 404 })
        : new Response(new TextEncoder().encode(held), { status: 200 });
    }

    if (method === "PUT") {
      objects.set(key, new TextDecoder().decode(body));

      return new Response("", { status: 200 });
    }

    if (method === "DELETE") {
      objects.delete(key);

      // 204 carries no body, and constructing one that does is a TypeError -
      // which the adapter would report as the bucket being unreachable.
      return new Response(null, { status: 204 });
    }

    return new Response("", { status: 405 });
  }

  function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function destination(url, method, body) {
    const path = url.pathname;

    if (path === "/user") return json({ login: seed.login });

    if (path === "/search/issues") {
      // The queue is the drafts: nothing asks GitHub what is waiting any more,
      // so a search arriving here is a regression, not a request to answer.
      throw new TypeError("the queue is derived from drafts: nothing may call /search/issues");
    }

    const issue = path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)(\/comments)?$/);

    if (issue) {
      const [, owner, repo, number, part] = issue;
      const key = `${owner}/${repo}#${number}`;
      const entry = (seed.issues || []).find((item) => String(item.number) === number);

      if (!part && method === "GET") {
        // No pull_request key: this number is an issue, and the interface reads
        // its absence as exactly that.
        return json({
          body: issueBodies.get(key) ?? "",
          title: entry?.title || "",
          html_url: entry?.html_url || "",
        });
      }

      if (!part && method === "PATCH") {
        const patched = JSON.parse(body);

        // A close is a PATCH too, told apart by what it carries: state and a
        // reason, never a body. Recorded under its own name so a test can say
        // "no close was sent" without parsing payloads.
        if (patched.state) {
          sent.push({ what: "close-issue", key, body: patched });

          return json({ html_url: entry?.html_url || "" });
        }

        // Written through, so a re-fetch after the patch reads the new body the
        // way GitHub would serve it.
        issueBodies.set(key, patched.body);
        sent.push({ what: "patch-issue", key, body: patched });

        return json({ html_url: entry?.html_url || "" });
      }

      if (part === "/comments" && method === "POST") {
        sent.push({ what: "issue-comment", key, body: JSON.parse(body) });

        return json({ html_url: `${entry?.html_url || ""}#issuecomment-1` });
      }
    }

    const pull = path.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)(\/[a-z]+)?$/);

    if (!pull) return json({ message: `nothing here: ${method} ${path}` }, 404);

    const [, owner, repo, number, part] = pull;

    // What a send's response points back at. GitHub answers with the pull
    // request's own address, and a test proving the interface distrusts even
    // that can hand the seed a hostile one.
    const pullUrl = seed.postedUrl || `https://github.com/${owner}/${repo}/pull/${number}`;

    if (!part) return json({ head: { sha: seed.headCommit } });
    if (part === "/files") return json(seed.files);

    if (part === "/reviews" && method === "POST") {
      sent.push({ what: "review", body: JSON.parse(body) });

      return json({ html_url: `${pullUrl}#pullrequestreview-1` });
    }

    if (part === "/comments" && method === "POST") {
      sent.push({ what: "comment", body: JSON.parse(body) });

      return json({ html_url: `${pullUrl}#discussion_r1` });
    }

    return json({ message: `nothing here: ${method} ${path}` }, 404);
  }

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const method = (options.method || "GET").toUpperCase();

    if (url.origin === seed.endpoint) return storage(url, method, options.body);
    if (url.origin === "https://api.github.com") return destination(url, method, options.body);

    // Anything else would have been a real request out of the machine. A commit
    // hook must never make one, so this is a failure rather than a pass-through.
    throw new TypeError(`the suite refused an unexpected request: ${method} ${url}`);
  };
})();
