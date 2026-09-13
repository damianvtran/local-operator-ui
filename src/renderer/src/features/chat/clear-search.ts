/**
 * The chat sidebar's search field: the clear action, and why it is a function.
 *
 * Clearing looks like one line of state, but it is two effects, and the second
 * is the one that regresses silently:
 *
 * 1. the query goes back to empty, and
 * 2. the caret goes back into the field.
 *
 * (2) is not decoration. The control that performs the clear is rendered only
 * while the query is non-empty, so the click unmounts it in the same commit as
 * the state update that emptied the query. Chrome drops focus to `<body>` when
 * the focused element leaves the DOM — it does not hand it to a sibling — so a
 * clear that only sets state leaves the user typing into the page again, and
 * the whole point of a clear control is that the user keeps typing.
 *
 * Extracted from the component so the pairing is testable without a DOM
 * harness (`scripts/clear-search.test.mjs` bundles this module): the repo has no
 * renderer unit-test runner, and a component-level assertion of this would have
 * to be a test that asserts nothing.
 */
export const clearSearch = (
	input: HTMLInputElement | null,
	apply: (value: string) => void,
): void => {
	// Clear first. A missing ref (before mount, or after the sidebar unmounts)
	// must not cost the state update — the query is the user's filter, and the
	// focus step is the enhancement.
	apply("");
	input?.focus();
};
