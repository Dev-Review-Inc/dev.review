// The front door.
//
// A reader who has attached storage of their own has read this page already,
// and is here to work rather than to be sold to. The root sends them on to the
// interface; everyone else gets the pitch.
//
// The decision belongs in the browser because what a reader has attached lives
// only in the browser. It is imported from the app rather than restated here,
// so the flag has one spelling and one set of rules across both.

import { entering } from "/app/src/app/theirs.js";

const where = entering(globalThis.localStorage, {
  search: location.search,
  top: globalThis.top === globalThis.self,
});

// Replace rather than assign, so the back button goes where the reader came
// from instead of to a page that would only send them here again.
if (where) location.replace(where);
