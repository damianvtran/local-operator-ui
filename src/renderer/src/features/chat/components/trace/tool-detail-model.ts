/**
 * The expanded tool detail as DATA: which lines the pane prints and what each
 * one says.
 *
 * Split out of `tool-detail.tsx` for the reason `tool-row-model.ts` is split out
 * of `tool-row.tsx`: these are rules with a right answer — how an argument value
 * is spelled, when a result is structured, what counts as a leaf — and there is
 * no React test host in this repo, so a rule that lives inside a component is a
 * rule nobody can falsify. `scripts/tool-detail.test.mjs` asserts these
 * directly.
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
 * 2. **Nothing is truncated.** The TUI bounds each value at `INPUT_MAX_LINES`
 *    and reports the remainder as "… N more lines", because a terminal is a
 *    fixed grid. The pane is a scroll region, so the bound moves to the
 *    container (`max-h`/`overflow-auto` in `tool-detail.tsx`) and a huge
 *    `write` payload is fully readable rather than counted.
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

/** One indent step in the TEXT projection (`detailText`), as the TUI counts it. */
const INDENT = "  ";

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
 * Does this call have anything to disclose?
 *
 * Deliberately CHEAP, and deliberately not the same question as "does the pane
 * print a line". The transcript builds every row's detail node whether or not
 * the row is open (React only runs the component on open), so this runs for
 * every tool row on every paint: walking the arguments here would re-walk a
 * `write`'s whole file content per frame. Which KEYS actually print is decided
 * inside the pane, where the walk happens once, while the row is open.
 */
export function hasDetail(
	args: Record<string, unknown> | null,
	output: string | null,
): boolean {
	if (output) return true;
	return args !== null && Object.keys(args).length > 0;
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
 * A container whose leaves are all empty (a result of `{}`) also returns
 * `null`: `detailText` would be the empty string and the pane would say nothing
 * where the tool said `{}`. The raw text is the honest fallback.
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
	return lines.length > 0 ? lines : null;
}
