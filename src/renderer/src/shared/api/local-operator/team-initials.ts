/**
 * The two-character mark a team's name is drawn by when there is no room for the
 * name itself (`TeamAvatarBubble` in the chat sidebar and the chat header's team
 * chip).
 *
 * WHY IT IS DETERMINISTIC AND PURE, and why it is stated once. This is the same
 * argument `team-display.ts` makes for its own one rule, for the same reason: the
 * initials are read from more than one surface (the sidebar's session rows and
 * the header's identity chip today, wherever a team is drawn compactly tomorrow),
 * and a second spelling of "which letters a team is" is how two surfaces end up
 * showing two different marks for one team. A pure function over the displayed
 * name is also the only shape that can be pinned by tests without a DOM.
 *
 * THE INPUT IS THE DISPLAY NAME (`teamDisplayName`: label, else slug), not the
 * slug and not the label: the bubble is drawn where a reader would otherwise have
 * read the name, so the initials have to come from the same string the name
 * channel shows. A team whose label is removed later changes its mark, and that
 * is the correct outcome - the mark is a compression of the name, not an
 * identity of its own.
 *
 * THE RULES, in the order they are applied:
 *
 *   1. The name is split on every run of non-alphanumerics (`-`, `_`, spaces,
 *      punctuation) AND on camelCase boundaries, so `release-crew` is two words
 *      and `localOperator` is two as well. Empty segments are dropped, so runs of
 *      separators and leading/trailing whitespace cost nothing.
 *   2. Two or more words take the first letter of the FIRST word and the first
 *      letter of the LAST - `Local Operator Development` is `LD`, not `LO`: the
 *      first and last words are what a reader of the full name anchors on, and a
 *      middle initial is the one a reader will misremember.
 *   3. One word takes its first two letters - `Content` is `CO`, `helpdesk` is
 *      `HE`. A single letter (a one-character word) is itself, which is the same
 *      rule with nothing to take a second letter from rather than a special case.
 *   4. A name with no alphanumerics at all (`"---"`, `""`) has nothing to take, so
 *      it draws `?` - a deterministic placeholder rather than an empty bubble,
 *      because an empty circle reads as a rendering failure and a `?` reads as a
 *      name we could not compress.
 *
 * The result is always UPPERCASE. `toUpperCase` is applied to the whole result
 * rather than per letter, which is what keeps the two shapes above one statement.
 *
 * ASCII ONLY, deliberately. Alphanumerics here are `[A-Za-z0-9]`, so a non-ASCII
 * letter is a separator: `Café` is one word and draws `CA`. This is a stated
 * limit rather than an oversight - the slugs teams are addressed by are ASCII by
 * construction, and the only name that can reach this function with non-ASCII
 * letters is a free-text label, where a locale-aware segmentation is a different
 * and much larger question (grapheme clusters, transliteration) that this
 * function does not pretend to answer.
 *
 * NOT AN ADDRESSING HELPER, the same boundary `teamDisplayName` draws: nothing
 * that writes - a command argument, a binding, a catalogue key - may route through
 * this function. It is decoration over a display name and never reaches the wire.
 */

/**
 * The word boundary the split below reads.
 *
 * Hoisted to a module constant rather than written inline: `teamInitials` runs
 * once per drawn team row on every list render, and a fresh regex literal per call
 * is a fresh object per call. It carries no `g` flag, so `.split` over it holds no
 * state between calls.
 *
 * THREE ALTERNATIVES, AND WHY EACH IS NEEDED: a run of non-alphanumerics covers
 * the slug and free-text cases (`release-crew`, `data quality`); `(?<=[a-z0-9])(?=[A-Z])`
 * cuts before a camel hump (`localOperator`); and `(?<=[A-Z])(?=[A-Z][a-z])` cuts
 * inside a leading acronym (`HTTPServer` is `HTTP` + `Server`, not `H` +
 * `TTPServer`), which is the one case the other two would split in the wrong
 * place.
 */
const WORD_BOUNDARY =
	/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;

export function teamInitials(displayName: string): string {
	const words = displayName
		.split(WORD_BOUNDARY)
		.filter((word) => word.length > 0);
	if (words.length === 0) return "?";
	const first = words[0];
	const last = words[words.length - 1];
	if (words.length === 1) return first.slice(0, 2).toUpperCase();
	return `${first[0]}${last[0]}`.toUpperCase();
}
