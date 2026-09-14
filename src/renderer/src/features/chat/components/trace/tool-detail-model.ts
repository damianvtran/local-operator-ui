/**
 * The expanded tool detail as DATA: which lines the pane prints and what each
 * one says.
 *
 * Split out of `tool-detail.tsx` for the reason `tool-row-model.ts` is split out
 * of `tool-row.tsx`: these are rules with a right answer — how an argument value
 * is spelled, when a result is structured, what counts as a leaf — and there is
 * no React test host in this repo, so a rule that lives inside a component is a
 * rule nobody can falsify. `scripts/tool-row.test.mjs` asserts these directly.
 *
 * Ported from the TUI's one-pane expansion (`ToolCard._build_content`,
 * `_append_input_body`, `_append_output_body` in
 * `local_operator/tui/widgets/tool_card.py`), which is the reference for what an
 * expansion IS: a labelled block per argument key, then the result body, in one
 * widget with no nested chrome. Two departures are deliberate and both come
 * from the operator's report that the expansions were unreadable:
 *
 * 1. **No JSON.** The TUI prints a structured argument with `json.dumps`, so an
 *    MCP call's `params` arrives as one line of `{"a": {"b": 1}}`. The pane this
 *    module feeds is forbidden from printing `{`, `}`, `[`, `]` or `"key":`.
 *    A nested value is flattened to one `key.subkey: value` line per LEAF
 *    instead — the reader gets the same information in the shape they would
 *    have navigated the JSON to reach, without the punctuation they have to
 *    navigate it with.
 * 2. **The bound moves to the container, and it is REPORTED.** The TUI bounds
 *    each value at `INPUT_MAX_LINES` and reports the remainder as "… N more
 *    lines", because a terminal is a fixed grid. The pane is a scroll region
 *    with one cap PER SECTION (input, result — `tool-detail.tsx`), so a long
 *    argument list cannot push the result's label off the pane and a huge
 *    `write` payload is fully readable rather than counted. What the pane keeps
 *    from the terminal is the REPORT (`detailOverflowLabel`): a cap whose
 *    overflow is invisible at rest is a pane claiming a completeness it does not
 *    have, and that is exactly how the result went missing — design round 1 (D1)
 *    measured the `Output` label 8px BELOW the pane's own bottom edge, with
 *    every committed frame at `scrollHeight == clientHeight` so no frame could
 *    show it.
 *
 * Argument ORDER is preserved: it is the TUI's order (`self._args.items()`) and
 * the row's own summary rule depends on it (`summaryFromArgs` — "the first two
 * identity scalars in argument order").
 */

/** One printed line of the pane. */
export type DetailLine = {
	/**
	 * Dotted path of the leaf — `path` at the top level, `params.filter.status`
	 * below it. Empty only for a bare value with no key at all.
	 */
	key: string;
	/**
	 * The value exactly as it prints: a string keeps its real newlines and is
	 * never escaped or quoted, a number and a boolean print as themselves.
	 */
	value: string;
	/** Leaf depth, 1 for a top-level argument. The only thing that indents. */
	depth: number;
};

/**
 * How deep the walker descends before it stops.
 *
 * `args` crosses an untyped boundary (`DesktopHistoryPage.entries[].payload`)
 * and reaches this module as whatever the producer sent. A recursive walk over
 * a pathologically deep payload would blow the render stack and take the whole
 * transcript down with it, so the walk is bounded rather than trusted; real
 * arguments nest two or three levels (MCP `params`, a `todos` array). The cut is
 * announced rather than silent — a marker in the TUI's own vocabulary
 * (`… earlier output not shown`, `… N more lines`).
 */
const MAX_DEPTH = 8;

/** What a cut-off subtree prints instead of its leaves. */
const DEEPER_VALUES = "… deeper values not shown";

/**
 * The app's own spelling for a section that exists and holds nothing.
 *
 * The producer writes `(empty)` as a section's body when a call printed nothing
 * on that stream (`tools/builtin.py:1694-1695`), and the object column already
 * treats it as wiring rather than as prose (`OUTPUT_WIRING_LINE` in
 * `tool-row-model.ts`). Reusing the same word for "this result is an empty
 * container" means a reader meets ONE spelling of nothing in this app instead of
 * a second dialect invented here.
 */
const EMPTY_CONTAINER = "(empty)";

/** One indent step in the TEXT projection (`detailText`), as the TUI counts it. */
const INDENT = "  ";

/**
 * The line under a capped section that says how much of it is not shown.
 *
 * Spelled exactly as the terminal spells it (`_append_input_body` /
 * `_append_output_body`, `tool_card.py`: `f"… {hidden} more line{'s' if hidden
 * != 1 else ''}"`), singular included, for the reason the diff body's
 * `diffOverflowLabel` gives: "… 1 more lines" is the kind of copy a reader
 * notices INSTEAD of the number.
 *
 * The count is what a reader would count — the rows of the section that are not
 * fully inside its box, so a wrapped value counts as the rows it occupies rather
 * than as the one argument it came from.
 */
export function detailOverflowLabel(hidden: number): string {
	return `… ${hidden} more line${hidden === 1 ? "" : "s"}`;
}

/**
 * The sub-pixel tolerance this pane's two placement decisions share.
 *
 * Both are comparisons of one rect against another — the section's content
 * against its box (`overflowing`, in `useSectionReport`) and each line box's
 * bottom edge against that same box (`linesBelowFold`) — and neither is exact:
 * the cap is authored in whole pixels (`max-h`), a line box is not (`line-height`
 * × the font's own metrics), and Chrome's non-composited scroller saturates on
 * an integer offset, so a section at its END can leave a fraction of a pixel of
 * its last line outside the box forever.
 *
 * The fraction is what makes this ONE constant rather than two numbers that can
 * drift: `overflowing` has carried it since the cap was written (a section that
 * fits exactly is not an overflow), and the count needed the same reading — at
 * 560 the residue is 0.203px in the first pane's input section and 0.469px in
 * the second's, and without it the marker went on saying `… 1 more line` about a
 * line the reader IS looking at, through eight real wheel notches, forever
 * (reviewer round 3 F8, design round 3 D7, two independent reproductions).
 *
 * A HALF PIXEL, not a round one: it is under the smallest distance a display
 * can paint (one device pixel at 1x) and comfortably above the sub-pixel
 * residues above, so it cannot hide a line the reader could actually lose.
 */
export const SUBPIXEL_TOLERANCE = 0.5;

/**
 * One row of a capped section as its own box measures it — the row's top edge
 * and its height, in the same coordinate space as the box's bottom edge.
 */
export type RowBox = { top: number; height: number };

/**
 * How many of a section's LINE BOXES sit below its fold — the arithmetic behind
 * `detailOverflowLabel`.
 *
 * The unit is the reader's, not the component's: a row is walked as its line
 * boxes (`Math.round(height / lineHeight)`) and each box is tested on its own
 * bottom edge, so a wrapped value counts as the lines it occupies and a value
 * between two others counts as one. Dividing the overflow by the block's ROW
 * PITCH (line-height plus row-gap) answers a different question and printed
 * `… 27 more lines` for the 33 a reader counted (QA round 2, Q-6).
 *
 * WHY IT IS HERE rather than inline in `tool-detail.tsx`: the pane's count is a
 * rule with a right answer, and rules inside a component are rules nobody can
 * falsify — no script under `pnpm test:desktop` imports the component and jsdom
 * measures no layout, so three mutations of that file (the marker mounted from
 * `scrollTop`, the pitch instead of the line boxes, an unmounted marker instead
 * of a quiet one) left the whole suite green (reviewer round 3, N6). The
 * FUNCTION is the part of that file that can be pinned cheaply: the caller does
 * the DOM reads and hands over plain numbers, and `scripts/tool-row.test.mjs`
 * then pins the sub-pixel boundary the frames and the rigs could only
 * photograph.
 *
 * The tolerance is a PARAMETER rather than this module's own choice, because
 * the caller has to make the same comparison for `overflowing` and one shared
 * constant is what keeps the two answers agreeing at the boundary.
 */
export function linesBelowFold(
	rows: readonly RowBox[],
	lineHeight: number,
	boxBottom: number,
	tolerance: number,
): number {
	// Defensive rather than required: the caller already refuses a non-finite
	// line-height, but this is exported now, and `height / 0` is Infinity — an
	// unbounded loop rather than a wrong number.
	if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;
	let below = 0;
	for (const row of rows) {
		// A row with no box (a hidden or empty element) occupies no line.
		if (row.height <= 0) continue;
		const boxes = Math.max(1, Math.round(row.height / lineHeight));
		for (let index = 1; index <= boxes; index++) {
			if (row.top + index * lineHeight > boxBottom + tolerance) below++;
		}
	}
	return below;
}

/**
 * The pane's content as plain text, one line per `DetailLine`.
 *
 * The component renders these as two spans rather than as text (the key takes
 * the label ink, the value the reading ink), so this exists as the one written
 * statement of what the pane SAYS: a test can assert over it directly — that a
 * multiline argument keeps its real newlines, that no JSON punctuation reaches
 * the reader — and the component's two spans have to keep agreeing with it.
 */
export function detailText(lines: readonly DetailLine[]): string {
	return lines
		.map(
			(line) =>
				INDENT.repeat(Math.max(0, line.depth - 1)) +
				(line.key ? `${line.key}: ` : "") +
				line.value,
		)
		.join("\n");
}

/**
 * One value as the pane should print it, or `null` when it prints nothing.
 *
 * The `null` return is the TUI's own rule (`_append_input_body`:
 * `if not text: continue`): a value that renders as nothing is dropped entirely
 * rather than leaving a bare `key:` line that reads as a rendering bug. It
 * covers the empty string, and — because an empty container has no leaf either
 * — `{}` and `[]`, which is the same fact about the same key.
 *
 * Strings are TRIMMED, as the TUI trims them (`value.strip()`): a `write`
 * argument's content is the whole file and its trailing newlines are the
 * file's, not the pane's, so they do not become blank rows under the block.
 * Interior newlines are untouched — a heredoc or a multi-line patch is the
 * shape of the thing being reported.
 */
function scalarText(value: unknown): string | null {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	// A function, a symbol, a bigint: nothing the wire can carry and nothing the
	// pane can print. `String(value)` would print source text.
	return null;
}

/** Is this a value the walker descends into rather than prints? */
function isContainer(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Every leaf of `value` under `key`, in `Object.entries` order.
 *
 * Arrays go through the same `Object.entries` path as objects, which is why
 * there is no second branch: an array's keys ARE its indices as strings, so
 * `key.0: first` falls out of the object rule and the pane has one spelling for
 * both. A container never prints a line of its own — only its leaves do, which
 * is what removes the braces.
 */
function walk(
	value: unknown,
	key: string,
	depth: number,
	out: DetailLine[],
): void {
	if (depth > MAX_DEPTH) {
		out.push({ key, value: DEEPER_VALUES, depth });
		return;
	}
	if (isContainer(value)) {
		for (const [childKey, child] of Object.entries(value)) {
			walk(child, key ? `${key}.${childKey}` : childKey, depth + 1, out);
		}
		return;
	}
	const text = scalarText(value);
	if (text === null) return;
	out.push({ key, value: text, depth });
}

/**
 * The call's arguments, one labelled block per key — the pane's input half.
 *
 * Each top-level key keeps its own path root, so the reader can tell where one
 * argument ends and the next begins even when a nested object and its sibling
 * print under the same prefix (`params.a` then `params.b`, both under one
 * `params`).
 */
export function argumentLines(
	args: Record<string, unknown> | null | undefined,
): DetailLine[] {
	if (!args) return [];
	const out: DetailLine[] = [];
	for (const [key, value] of Object.entries(args)) walk(value, key, 1, out);
	return out;
}

/**
 * How many nodes `hasDetail` may look at before it answers.
 *
 * The gate runs for every tool row on EVERY PAINT — the transcript builds every
 * row's detail node whether or not the row is open, and React runs the pane's own
 * walk only on open — so the walk is bounded rather than trusted. The bound is on
 * NODES, not bytes: a `write`'s file content is one string LEAF and costs one
 * visit however large it is, which is why the gate can afford to be exact at all.
 *
 * 512 is far above any real argument list (a `todos` array of fifty objects is a
 * couple of hundred nodes and stops at its first printable leaf), and exhaustion
 * answers the OPTIMISTIC way. The two failures are not equal: a row that hides a
 * real payload behind a disclosure it never offers loses information silently,
 * while an offered click onto nothing is visible and is closed by the pane's own
 * empty guard (`ToolDetail` paints nothing when it has nothing to paint).
 */
const DETAIL_PROBE_MAX_NODES = 512;

/**
 * Does this call have anything to disclose?
 *
 * The question the PANE answers is "does `argumentLines` print a line", so this
 * gate has to AGREE with it rather than approximate it. `{params: {}}`,
 * `{a: []}` and `{a: ""}` all have a key and all print nothing, which is how a
 * durable `read` row whose arguments are `{"path": ""}` came to offer a
 * disclosure onto a bordered, padded, empty `sunken` box (reviewer F2, QA Q-2).
 *
 * Every input the pane can receive is exact here: an all-empty container, an
 * empty string value, an array of empties, an empty-OBJECT root, and `args`
 * `null` or `undefined` — the last of which used to THROW (`Object.keys(undefined)`)
 * while its sibling `argumentLines` treated the same value as nothing.
 *
 * The walk mirrors `walk`'s rules: a container descends, a leaf prints unless
 * `scalarText` drops it, and a subtree cut at `MAX_DEPTH` PRINT the deeper-values
 * marker — so a depth cut is content on both sides of this gate.
 */
export function hasDetail(
	args: Record<string, unknown> | null | undefined,
	output: string | null,
): boolean {
	if (output) return true;
	if (!args) return false;
	let budget = DETAIL_PROBE_MAX_NODES;
	const printable = (value: unknown, depth: number): boolean => {
		if (budget-- <= 0) return true;
		if (depth > MAX_DEPTH) return true;
		if (!isContainer(value)) return scalarText(value) !== null;
		for (const child of Object.values(value)) {
			if (printable(child, depth + 1)) return true;
		}
		return false;
	};
	for (const value of Object.values(args)) {
		if (printable(value, 1)) return true;
	}
	return false;
}

/**
 * A tool result that is ENTIRELY a JSON object or array, as detail lines — or
 * `null` when the result is not that, and the caller should print it as text.
 *
 * The gate is deliberately narrow. Only a result that parses cleanly AND whose
 * root is a container is structured: a bare `3` or a quoted string is a value
 * the tool chose to encode, not a record, and re-printing it as `x: 3` under an
 * invented key would be the pane making something up. Anything that does not
 * parse — which is every `exit code: 0` + stdout block, and every plain-text
 * tool — returns `null` and is printed byte-for-byte as it arrived.
 *
 * A container whose leaves are all empty (`{}`, `{"a": {}}`, `{"items": []}`)
 * prints ONE line — the app's own `(empty)` — rather than returning `null` and
 * letting the raw text through. Raw text was the earlier answer and it is not
 * honest: it puts `{"a": {}}` under the `Output` label, which is the JSON
 * punctuation this whole pane exists to keep out, and empty containers are
 * REACHABLE — an empty object is what a "no rows found" API returns (reviewer
 * F4). `(empty)` is what the producer itself writes when a section held nothing
 * (`tools/builtin.py`), so the pane says the same word the app says elsewhere
 * rather than inventing a second dialect for the same fact.
 */
export function resultLines(
	output: string | null | undefined,
): DetailLine[] | null {
	if (!output) return null;
	const trimmed = output.trim();
	// Cheap gate before the parse, because this runs on every expansion of every
	// tool row and most results are a shell command's output.
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (!isContainer(parsed)) return null;
	const lines = argumentLines(parsed as Record<string, unknown>);
	return lines.length > 0
		? lines
		: [{ key: "", value: EMPTY_CONTAINER, depth: 1 }];
}
