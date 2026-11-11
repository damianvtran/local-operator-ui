/**
 * `micromark-extension-math@3.1.0`'s `resolveMathText` (MIT, (c) Titus Wormer
 * et al), vendored verbatim in its own module because TWO constructs share it:
 * the guarded single-dollar tokenizer (`markdown-math-guarded.ts`) and the
 * `\(...\)` / `\[...\]` text construct (`markdown-math-backslash.ts`). Both
 * emit upstream's `mathText` token shape, so one copy of the algorithm serves
 * both, and neither module has to import the other (the guarded module's
 * plugin registers the backslash constructs, so an import the other way would
 * be a cycle). Refresh with the rest of the vendored code: see PROVENANCE AND
 * REFRESH in `markdown-math-guarded.ts`.
 */

type Token = { type: string; end: unknown };
type Event = [enter: string, token: Token, context: unknown];

/**
 * Upstream's resolver, unchanged: it merges adjacent data and marks the
 * padding spaces of a span whose ends are both spaces. (With the guards in
 * `markdown-math-guarded.ts` a single-dollar span can no longer start or end on a space, so for those the
 * padding branch is unreachable; it stays because `$$`-opened and multi-dollar
 * spans still reach it, and they must resolve exactly as they did.)
 */
export function resolveMathText(events: Event[]): Event[] {
	let tailExitIndex = events.length - 4;
	let headEnterIndex = 3;
	let index: number;
	let enter: number | undefined;

	// If we start and end with an EOL or a space.
	if (
		(events[headEnterIndex][1].type === "lineEnding" ||
			events[headEnterIndex][1].type === "space") &&
		(events[tailExitIndex][1].type === "lineEnding" ||
			events[tailExitIndex][1].type === "space")
	) {
		index = headEnterIndex;

		// And we have data.
		while (++index < tailExitIndex) {
			if (events[index][1].type === "mathTextData") {
				// Then we have padding.
				events[tailExitIndex][1].type = "mathTextPadding";
				events[headEnterIndex][1].type = "mathTextPadding";
				headEnterIndex += 2;
				tailExitIndex -= 2;
				break;
			}
		}
	}

	// Merge adjacent spaces and data.
	index = headEnterIndex - 1;
	tailExitIndex++;
	while (++index <= tailExitIndex) {
		if (enter === undefined) {
			if (index !== tailExitIndex && events[index][1].type !== "lineEnding") {
				enter = index;
			}
		} else if (
			index === tailExitIndex ||
			events[index][1].type === "lineEnding"
		) {
			events[enter][1].type = "mathTextData";
			if (index !== enter + 2) {
				events[enter][1].end = events[index - 1][1].end;
				events.splice(enter + 2, index - enter - 2);
				tailExitIndex -= index - enter - 2;
				index = enter + 2;
			}
			enter = undefined;
		}
	}
	return events;
}
