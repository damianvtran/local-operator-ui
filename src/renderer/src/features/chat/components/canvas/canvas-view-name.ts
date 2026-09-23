/**
 * The accessible name of one canvas view-switcher segment.
 *
 * THE COUNT RIDES THE NAME rather than a badge (there is no room for a figure inside
 * a 24px icon button), so this function is the only place either segment's number is
 * spoken — which is why it is a module of its own rather than a template literal in
 * the pane: the number is a CLAIM about a list, and a claim needs somewhere to be
 * tested.
 *
 * `truncated` IS THE GOALS SEGMENT'S ALONE (design review round 1, F5). The pane
 * carries `goal_history_truncated` and is scrupulous about it — it says "this list is
 * capped" beside the rows and refuses to print a total it cannot see — but the
 * segment outside the pane spoke its `goalHistory.length` as a total: a screen-reader
 * user heard "Goals view, 3 goals" and only learned the list was capped after opening
 * the pane, which is the same under-report the flag exists to prevent, one surface
 * out. The caveat is appended rather than the count dropped, because the count is
 * still the honest answer to "is there anything in here" — what it is not is complete,
 * and the clause says so. The words are the pane's own (`canvas-goals-viewer.tsx`), so
 * the two surfaces say one thing.
 *
 * `shown` is load-bearing beside the caveat: "3 goals — this list is capped" can be
 * read as the list HOLDING three goals, where "3 goals shown" cannot.
 *
 * A `files` count has no cap to admit — the documents are the open tabs the strip
 * already prints — so that segment calls this with `truncated` unset and keeps the
 * shipped shape.
 */
export const viewSegmentName = (
	label: string,
	noun: string,
	counted: number,
	truncated = false,
): string => {
	const count = `${counted} ${counted === 1 ? noun : `${noun}s`}`;
	if (truncated) return `${label} view, ${count} shown — this list is capped`;
	return counted > 0 ? `${label} view, ${count}` : `${label} view`;
};
