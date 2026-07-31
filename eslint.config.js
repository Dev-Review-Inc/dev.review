// Flat config. There was no ESLint configuration before this, which meant the
// pre-commit step invoking it was passing without checking anything.
//
// The rules are deliberately few. This codebase has no dependencies and no
// build step, so the value of a linter here is catching the mistakes that cost
// a debugging session - an unused binding, a shadowed name, a typo'd global -
// not enforcing a style that review already covers.
//
// require-atomic-updates is deliberately absent. Every one of its eleven hits
// here is a property assigned after an await in single-threaded UI code, which
// is what this application is made of. A rule that fires on the normal shape of
// the codebase trains people to ignore the linter.

export default [
  {
    // Vendored third-party code, which is minified and is not ours to fix. It
    // is checked by the thing that matters for a vendored file, which is that
    // it still matches upstream, not by a linter with opinions about shadowed
    // names in a webpack bundle. Linting it fails the pre-commit step with five
    // thousand errors nobody can act on, which is the same as having no linter.
    // src-tauri/target is cargo's build output. It holds the assets the desktop
    // build embedded, so it appears the moment anyone compiles and it is not
    // source at all.
    ignores: ["web/vendor/**", "src-tauri/target/**"],
  },
  {
    // The service worker has its own globals and is not a page.
    files: ["web/sw.js"],
    languageOptions: {
      globals: { self: "readonly", caches: "readonly", fetch: "readonly", console: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
  {
    // The suites and the skills run in node, not a browser.
    files: ["test/**/*.js", "e2e/**/*.js", "skills/**/*.js", "skills/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        globalThis: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        AbortController: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        structuredClone: "readonly",
        Response: "readonly",
        Request: "readonly",
        WebSocket: "readonly",
        AbortSignal: "readonly",
        DOMException: "readonly",
        performance: "readonly",
        queueMicrotask: "readonly",
      },
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        // The browser surface the app actually uses.
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        fetch: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        indexedDB: "readonly",
        localStorage: "readonly",
        crypto: "readonly",
        globalThis: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        AbortController: "readonly",
        EventSource: "readonly",
        CustomEvent: "readonly",
        HTMLElement: "readonly",
        getComputedStyle: "readonly",
        matchMedia: "readonly",
        showDirectoryPicker: "readonly",
        alert: "readonly",
        performance: "readonly",
        queueMicrotask: "readonly",
        Response: "readonly",
        Request: "readonly",
        WebSocket: "readonly",
        AbortSignal: "readonly",
        DOMException: "readonly",
        // Node, for the skills, the generator and the tests.
        process: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-shadow": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-fallthrough": "error",
      "no-self-compare": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable-loop": "error",
      eqeqeq: ["error", "smart"],
    },
  },
];
