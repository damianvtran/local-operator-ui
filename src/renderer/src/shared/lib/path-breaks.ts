/**
 * Break opportunities inside a machine value that has no spaces to break at.
 *
 * A path is one word to the line breaker, so once it runs out of room the
 * browser splits it wherever that lands - the captured frame read
 * `/Users/operator/Library/Cach` / `es/local-operator-ui-`, a break inside a
 * path segment that looks like a typo in exactly the string the copy button
 * exists for (review D7). A zero-width space after each path separator gives the
 * line a break opportunity at every segment boundary, which is where a person
 * would break it.
 *
 * It lives here, apart from the panel that renders it, for one reason: this rule
 * is a guard on hostile input (paths, URLs, a locale date) and a guard nothing
 * can falsify is a comment. `scripts/update-robustness.test.mjs` bundles this
 * module and asserts the cases below against the shipped regex.
 */

/**
 * A path separator that may take a line break: a `/` whose next character is
 * neither a digit nor another slash.
 *
 * The digit guard keeps the rule inside the value it was written for. A details
 * line is not always a path - the same field carries the locale start time,
 * `13/09/2026, 09:39:00` - and a break opportunity after `13/` would let that
 * date split across two lines, which is the same mid-token break this rule
 * exists to remove, moved from the path to the date. Nothing is lost by
 * refusing it: a date fits on a line, and a path segment that does begin with a
 * digit keeps the separators on either side of it.
 *
 * The slash guard refuses a break INSIDE a scheme separator. `//` is one token
 * to a reader - a UNC or network path, and the `://` of every URL - and a break
 * opportunity between the two slashes is one a person would never choose; it was
 * reachable because the digit guard alone lets `//` through (review N4). What
 * remains is the break a person does choose: `https://` then the host,
 * `//` then the first segment. Nothing in the app's own details strings carries
 * a `://` today, which is why this was latent rather than live - the guard is
 * cheap and the next payload that quotes a URL would have made it visible.
 */
export const BREAKABLE_SEPARATOR = /\/(?![\/\d])/g;

/**
 * The value with a zero-width space inserted after every breakable separator.
 *
 * What it does NOT do is leave the value alone for readers who take it out of
 * the DOM: the copy button, the clipboard and the label all read the raw
 * `detail`, so nothing copied by the button gains an invisible character - but a
 * user who hand-selects the rendered span and copies it does get the U+200B
 * characters. That is the accepted cost of the rule: the button exists for
 * exactly this job, and a break at a segment boundary is worth an invisible
 * character in a hand-selection that was never the supported path (review N5,
 * UX U6).
 */
export const withPathBreaks = (value: string): string =>
	value.replace(BREAKABLE_SEPARATOR, "/\u200B");
