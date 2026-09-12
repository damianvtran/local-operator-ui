/**
 * The arithmetic behind a tool row, ported from the TUI's ledger.
 *
 * Source of truth: `local_operator/tui/widgets/tool_card.py` and
 * `local_operator/tui/glyphs.py`. These are pure functions with no React and no
 * DOM so the port can be asserted against the Python rules it mirrors rather
 * than eyeballed in a story — `scripts/transcript-reducer.test.mjs` bundles and
 * exercises them.
 *
 * Why port the rules at all, rather than invent web-native ones: a user who
 * learns to scan a conversation in the terminal must not have to learn it again
 * in the app. The *medium* differs — proportional text, a real hover ground, no
 * cell grid — but which fact lands in which column, and which fact is dropped
 * first when there is no room, are decisions this file keeps identical.
 */

/**
 * Arguments that identify WHAT a call acted on, as opposed to its payload.
 *
 * `tool_card.py:309-321`. The order matters only in that a call's own argument
 * order decides which two survive; membership is what separates `write`'s
 * `path` from its `content`. Joining the first two scalars without this set
 * buries the filename under the first sixty characters of the file being
 * written, which is the one thing the row exists to say.
 */
const IDENTITY_ARGS = new Set([
	"command",
	"path",
	"file_path",
	"url",
	"pattern",
	"query",
	"name",
	"target",
	"message",
]);

/** The minted prefix every MCP tool name carries. */
const MCP_PREFIX = "mcp__";

/**
 * Shrink a whole-token absolute path against the home directory.
 *
 * `compact_path` (tool_card.py:420-439) tries the cwd first and then `$HOME`.
 * The renderer has neither: a browser has no cwd, and the session's cwd lives
 * on frontend state that a pure function must not reach for. So only the home
 * rewrite ports, and it is driven by the paths themselves — every absolute path
 * under a macOS/Linux home shares the `/Users/<name>/` or `/home/<name>/`
 * shape, which is recoverable from the string without asking the host.
 *
 * Only whole tokens are rewritten, exactly as the TUI does: a sentence that
 * merely mentions a slash keeps its wording, because the rewrite is for paths
 * eating the summary budget, not for prose.
 */
const HOME_PATH = /^\/(?:Users|home)\/[^/]+\//;

/** Collapses whitespace in a model-supplied peer target. */
const WHITESPACE = /\s+/;

export function compactPath(text: string): string {
	if (!text.startsWith("/") || text.includes(" ")) return text;
	return text.replace(HOME_PATH, "~/");
}

/** One argument value flattened to a single compact line, or "" if unusable. */
function scalarText(value: unknown): string {
	if (typeof value === "string") {
		return compactPath(value.trim()).replace(/\n/g, " ").trim();
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return "";
}

/**
 * The delivery promise of a `send` call in one word.
 *
 * Mirrors `tools.builtin.peer_send_mode_label`. `wake` is the default, so only
 * an explicit `wake: false` is quiet.
 */
function sendMode(args: Record<string, unknown>): string {
	if (args.now) return "now";
	return args.wake === false ? "quiet" : "wake";
}

/** The addressed peer, mirroring `peer_send_target_label`'s precedence. */
function sendTarget(args: Record<string, unknown>): string {
	const pid = args.pid;
	if (typeof pid === "number" && Number.isFinite(pid)) return `pid ${pid}`;
	const session = String(args.session ?? "").trim();
	if (session) return `session ${session}`;
	// `?` rather than blank: the call will fail, but the row is painted first,
	// and an empty slot reads as though the next field were the target.
	return (
		String(args.target ?? "")
			.split(WHITESPACE)
			.filter(Boolean)
			.join(" ") || "?"
	);
}

/**
 * `send`'s summary, with the delivery mode LEADING.
 *
 * `_send_summary` (tool_card.py:451-489). The mode leads because the row
 * truncates from the right: with the marker after the target, three calls to
 * the same peer with three different delivery promises rendered identically at
 * ordinary widths, and one of them woke a peer while another did not. The
 * discriminator goes ahead of the free-text identity.
 */
function sendSummary(args: Record<string, unknown>): string {
	const parts = [
		sendMode(args),
		scalarText(sendTarget(args)) || "?",
		scalarText(args.message),
	];
	return parts.filter(Boolean).join(" · ");
}

/**
 * One-line summary of WHAT the call is acting on.
 *
 * `_summary_from_args` (tool_card.py:492-515): identity arguments first, in
 * argument order, falling back to every scalar for an unknown or MCP tool that
 * has no recognisable identity argument; first two joined with a space; the
 * tool's own name when nothing survives.
 */
export function summaryFromArgs(
	toolName: string,
	args: Record<string, unknown> | null,
): string {
	const name = toolName.trim();
	if (!args) return name;
	if (name === "send") return sendSummary(args) || name;
	let parts = Object.entries(args)
		.filter(([key]) => IDENTITY_ARGS.has(key))
		.map(([, value]) => scalarText(value))
		.filter(Boolean);
	if (parts.length === 0) {
		parts = Object.values(args).map(scalarText).filter(Boolean);
	}
	return parts.slice(0, 2).join(" ") || name;
}

/**
 * What the row's NAME column says.
 *
 * `glyphs.display_name` (glyphs.py:267+). Builtins are already their own best
 * name. An MCP tool is not: `create_mcp_tool_name` mints
 * `mcp__<server>_<tool>`, and in a narrow column that constant `mcp__` eats
 * five characters before a single informative one — three tools from one server
 * all read `mcp__lin`, which is the scan-by-shape premise failing for the tool
 * class a user is most likely to have a dozen of. The plug glyph already says
 * "this came from a server", so the name column drops the prefix and the server
 * segment and keeps the CALL.
 *
 * A server whose own name contains an underscore cannot be split back out, so
 * only the FIRST segment is treated as the server — the remainder is still the
 * call's identifier rather than the constant. Never returns empty: a name that
 * is nothing but the prefix keeps whatever it had.
 */
export function displayName(toolName: string): string {
	const name = toolName.trim();
	if (!name.toLowerCase().startsWith(MCP_PREFIX)) return name;
	const rest = name.slice(MCP_PREFIX.length);
	const split = rest.indexOf("_");
	if (split <= 0) return rest || name;
	return rest.slice(split + 1) || rest;
}

/**
 * Whether a summary carries nothing the name column does not already say.
 *
 * `summaryFromArgs` falls back to the tool's own WIRE name when no argument is
 * summarisable. In the TUI that fallback is nearly invisible — the name column
 * is 8 cells, so `list_variables` truncates to `list_var` and the summary is
 * the only place the full name appears. This app's column GROWS to the longest
 * visible name, which turns the same fallback into `list_variables
 * list_variables`: the exact stutter the fallback exists to avoid.
 *
 * Both spellings count. The row displays `displayName(toolName)` while the
 * fallback is the wire name, and for an MCP tool those differ — the column
 * shows `list_issues` while the summary would read `mcp__linear_list_issues`.
 * Comparing against the displayed name alone let the stutter through on the
 * tool class most likely to produce a dozen argument-less rows in a row, and
 * printed the very prefix `displayName` had just stripped.
 *
 * Exported because two surfaces need the SAME answer: the row decides whether
 * to drop the summary, and the transcript decides whether to offer a stand-in
 * fact in its place. If those two disagreed, a row would either show a
 * fallback it did not need or go blank with one available.
 */
export function isBareToolName(summary: string, toolName: string): boolean {
	return summary === toolName || summary === displayName(toolName);
}

/**
 * Integer-seconds duration, bounded at six characters over its whole domain.
 *
 * `format_duration` (tool_card.py:338-387). Used for a RUNNING row and for any
 * settled row past a minute. Widest strings: `59m59s`, `23h59m`, `99d23h`.
 */
export function formatDuration(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	if (total < 60) return `${total}s`;
	if (total < 3600) {
		const m = Math.floor(total / 60);
		const s = total % 60;
		return s === 0 ? `${m}m` : `${m}m${s}s`;
	}
	if (total < 86400) {
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		return m === 0 ? `${h}h` : `${h}h${m}m`;
	}
	const d = Math.floor(total / 86400);
	if (d > 99) return "100d+";
	const h = Math.floor((total % 86400) / 3600);
	return h === 0 ? `${d}d` : `${d}d${h}h`;
}

/**
 * A SETTLED row's duration, which is deliberately not the running format.
 *
 * `_outcome_runs` (tool_card.py:2376-2396): a tenth of a second below ten
 * seconds, whole seconds below a minute, then the integer format above. The
 * tenth matters only where it is the difference between a call that was
 * instant and one that was not; past ten seconds it is noise in a column.
 *
 * `null` is a replayed row whose duration the transcript did not keep — the
 * slot stays empty rather than claiming zero.
 */
export function formatSettledDuration(seconds: number | null): string {
	if (seconds === null) return "";
	const elapsed = Math.max(0, seconds);
	if (elapsed < 10) return `${elapsed.toFixed(1)}s`;
	if (elapsed < 60) return `${Math.round(elapsed)}s`;
	return formatDuration(elapsed);
}

/**
 * Diff counters, or zero for anything that is not a positive count.
 *
 * `_diff_counts` (tool_card.py:567-583) accepts a value only when it is an
 * integer and not a boolean and greater than zero; missing, malformed, negative
 * and `true` all become zero. A zero is never rendered — `+0` states that
 * nothing was added, which is a different claim from "the count is unknown",
 * and the rows that carry no counts are the second kind.
 */
export function diffCount(value: unknown): number {
	if (typeof value !== "number") return 0;
	if (!Number.isInteger(value) || value <= 0) return 0;
	return value;
}

/** The TUI's four name categories, for the settled name's ink. */
export type ToolCategory = "read" | "mutate" | "exec" | "meta" | "plain";

/**
 * `_TOOL_CATEGORY` (tool_card.py:178-198), looked up case-insensitively
 * because a tool name is MODEL-controlled: a provider echoing `Bash` must land
 * in the same category as `bash`. Anything unlisted — an MCP tool, a custom
 * tool — is `plain`.
 */
const CATEGORIES: Record<string, ToolCategory> = {
	read: "read",
	glob: "read",
	grep: "read",
	web_fetch: "read",
	web_search: "read",
	browser: "read",
	list_variables: "read",
	read_variable: "read",
	write: "mutate",
	edit: "mutate",
	bash: "exec",
	eval: "exec",
	task: "meta",
	agent: "meta",
	hub: "meta",
	todo: "meta",
	send: "meta",
	wake: "meta",
	ask: "meta",
};

export function toolCategory(toolName: string): ToolCategory {
	return CATEGORIES[toolName.trim().toLowerCase()] ?? "plain";
}

/**
 * Floor and ceiling of the shared name column, in characters.
 *
 * `TOOL_NAME_COL = 8` and `TOOL_NAME_COL_MAX = 24` (transcript.py:242-243).
 * The column is shared across every visible row so names stack into one edge
 * and the summaries beside them start on one rail; it GROWS to the longest
 * visible name rather than being fixed, because a transcript of `read`/`edit`
 * calls should not pay 24 characters of gutter for a tool it never called.
 */
export const TOOL_NAME_COL_MIN = 8;
export const TOOL_NAME_COL_MAX = 24;

/** The shared column width for a set of visible tool names. */
export function toolNameColumn(names: readonly string[]): number {
	let longest = 0;
	for (const name of names) longest = Math.max(longest, name.length);
	return Math.min(TOOL_NAME_COL_MAX, Math.max(TOOL_NAME_COL_MIN, longest));
}

/* ----------------------------------------------------------- diff body */

/**
 * The tools whose expansion IS the diff.
 *
 * Only the two this backend has. `_TOOL_CATEGORY` (tool_card.py:178-198) lists
 * exactly `write` and `edit` as mutating tools, and `_diff_details`
 * (tools/builtin.py:4863-4888) is called from `execute_write` and
 * `execute_edit` alone. The mobile port's set also names `apply_patch` and
 * `patch` (mobile/web/src/components/tool-row.tsx:75); this backend exposes no
 * such tool, so listing them here would claim support for a name that can only
 * arrive from an MCP server shadowing it — and an MCP row's `details` are not
 * this payload.
 */
export const DIFF_BODY_TOOLS = new Set(["write", "edit"]);

/** Whether a row's expansion is the diff body rather than its arguments. */
export function isDiffBodyTool(toolName: string): boolean {
	return DIFF_BODY_TOOLS.has(toolName.trim().toLowerCase());
}

/**
 * Whether a settled row expands to its DIFF rather than to its arguments.
 *
 * Three conditions, and the third is the terminal's own: `_build_content`
 * selects the diff-alone body on `self._state == "success" and self._diff`
 * (tool_card.py:1928-1939), and that success gate is not decorative. A case it
 * rejects is a write that FAILED: the args are the only account of what was
 * attempted and the error only makes sense beside them, so a row that shipped
 * both a diff and an error must paint the arguments and the error, not a diff
 * alone. The producer agrees today — every error exit goes through `_error`
 * (tools/builtin.py:1041) or `_invalid_arguments` (`:1051`, which does set
 * `details`, but only its `FAULT_KEY` fault marker at `:1066`; it is
 * `details.diff` that no error path sets), and all 9,501 real rows carrying
 * `details.diff` measured on 2026-09-12 are successful
 * `write`/`edit` results — so the guard has no live case; it is here because the
 * reference keeps it and "no producer does this yet" is not a rule a renderer
 * can rely on. `scripts/tool-row.test.mjs` pins it.
 *
 * It lives here rather than inline in `canonical-transcript.tsx` so the rule has
 * one home a test can exercise: there is no React test host in this repo, and an
 * expression buried in a JSX ternary is only assertable by reading the source.
 */
export function isDiffBodyRow<
	T extends {
		toolName: string;
		diff: readonly string[] | null;
		isError: boolean;
	},
>(row: T): row is T & { diff: readonly string[] } {
	return isDiffBodyTool(row.toolName) && row.diff !== null && !row.isError;
}

/**
 * The unified diff a `write`/`edit` RESULT carries, as view-ready lines.
 *
 * Source of truth: `_diff_details` (tools/builtin.py:4863-4888) puts a
 * `difflib.unified_diff(..., n=2, lineterm="")` line list on `details.diff`,
 * capped at `_DIFF_DETAILS_CAP_LINES = 200` with a literal `…` appended as the
 * LAST element when it truncated. Nothing on this side recomputes a diff — the
 * payload is the producer's own bytes, which is what keeps the row's `+N/-N`
 * counters and the body beside them describing one change.
 *
 * A string payload is tolerated, and it is DEFENSIVE TOLERANCE rather than a
 * shape any producer emits. Measured over every transcript on this machine:
 * 9,501 `details.diff` values across the 1,166 stored transcripts it held on
 * 2026-09-12 are lists of strings
 * — no strings, no non-string members, no empty lists, none on an `is_error` row
 * (a dated snapshot of a live store, not a fixed property) — and the fold this file
 * used to blame for the string shape does not produce one either:
 * `mobile/projection.py:284-288` copies each key through untouched, so a list
 * stays a list. (The phone's `diff?: string | string[]` type is its own
 * normaliser's tolerance, not evidence about the wire.) The belt costs one
 * `typeof` at a boundary that is `unknown` by construction; `Array.isArray`
 * alone would drop a row's body while the counters beside it still said `+42`.
 * The reason to keep it is untyped boundaries, not provenance.
 *
 * Non-string members are DROPPED rather than stringified: `String({})` is
 * `"[object Object]"`, a line no producer ever wrote, and a diff is a record of
 * what happened. Absent, empty and all-malformed payloads are `null` — "this
 * call reported no diff" — and a row with no diff keeps its arguments, which is
 * the honest shape for a call that reported nothing.
 */
export function diffFromDetails(details: unknown): string[] | null {
	if (!details || typeof details !== "object") return null;
	const raw = (details as Record<string, unknown>).diff;
	if (typeof raw === "string") {
		// Tolerance for an untyped boundary, not a producer's shape: every real
		// payload measured is a list (see the doc above). An empty string is "no
		// diff", not one blank line.
		return raw ? raw.split("\n") : null;
	}
	if (!Array.isArray(raw)) return null;
	const lines = raw.filter((line): line is string => typeof line === "string");
	return lines.length ? lines : null;
}

/** Element-wise equality, for the identity gate below. */
export function sameDiff(
	a: readonly string[] | null,
	b: readonly string[] | null,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * Never let a replay erase a diff a row already showed.
 *
 * "This event carried no diff" and "this call reported no change" are different
 * claims, and only the second may clear a row — the same argument
 * `preferExisting` makes for images. The live-event budget strips `details` from
 * a later frame (`_bound_live_result_in_place`, session/frontend_state.py,
 * drops `details` when the row exceeds its share of the frame), so a replayed
 * `tool_execution_end` legitimately arrives with nothing where a diff already
 * sat, and letting that win would blank the body of the row the user is
 * reading.
 *
 * Returns the previous array BY REFERENCE whenever the two are equal, which is
 * what keeps the record's identity stable: `shallowEqual` compares by `!==`, so
 * a freshly built array of identical lines would report every polled delta as a
 * change and re-render the row (and its 200-line body) on a surface that
 * repaints per token.
 */
export function preferDiff(
	next: string[] | null,
	previous: string[] | null,
): string[] | null {
	if (next === null) return previous;
	if (sameDiff(next, previous)) return previous;
	return next;
}

/**
 * Drop the nameless `---`/`+++` file-header pair, POSITIONALLY.
 *
 * `_append_diff_body` (tool_card.py:2178-2225). The tool diffs one file's
 * before/after in memory, so `difflib` emits the headers with EMPTY filenames
 * (`"--- "` / `"+++ "`, trailing space from the empty name and no line
 * terminator) and the path already heads the summary row. Two blank-label rows
 * above every diff were pure chrome.
 *
 * Only lines 0 and 1 are examined, and only when they are exactly that pair
 * after trailing-whitespace removal. A PATTERN filter over the body would be a
 * data-loss bug rather than a cosmetic one: a removed content line can itself
 * begin `--` (a SQL/Lua comment, say) and renders as `--- …` inside the body,
 * so a pattern filter would silently delete the very record this body now
 * solely carries.
 */
export function stripDiffHeader(diff: readonly string[]): string[] {
	if (
		diff.length >= 2 &&
		rstrip(diff[0]) === "---" &&
		rstrip(diff[1]) === "+++"
	) {
		return diff.slice(2);
	}
	return diff.slice();
}

/** Trailing whitespace on a diff line, for the terminal's `rstrip()`. */
const TRAILING_WHITESPACE = /\s+$/;

/** Trailing-whitespace removal, matching the terminal's `rstrip()` per line. */
function rstrip(line: string): string {
	return line.replace(TRAILING_WHITESPACE, "");
}

/** Where a diff line's ink comes from, by its LEADING character only. */
export type DiffLineKind = "hunk" | "added" | "removed" | "context";

/**
 * The line's kind, from its leading character alone.
 *
 * `_append_diff_body` (tool_card.py:2208-2218): `@` is a hunk header, `+` an
 * addition, `-` a removal, and everything else is context. Only the FIRST
 * character is consulted, so a context line whose text happens to start with
 * `-` after its own marker is still context.
 *
 * The KIND decides the ink for the WHOLE line (diff-block.tsx), which is what
 * the same loop does at `:2220`.
 */
export function diffLineKind(line: string): DiffLineKind {
	const marker = line.slice(0, 1);
	if (marker === "@") return "hunk";
	if (marker === "+") return "added";
	if (marker === "-") return "removed";
	return "context";
}

/**
 * Lines the expanded body shows, `EXPAND_MAX_LINES` in the terminal.
 *
 * `EXPAND_MAX_LINES = 40` (tool_card.py:276) is the shared cap for every
 * expanded body, so a diff and an output block shed at the same depth.
 */
export const DIFF_EXPAND_MAX_LINES = 40;

/** One rendered diff line: the ink marker, the rest, and the kind they came from. */
export type DiffBodyLine = {
	/** The line as painted, trailing whitespace removed. */
	text: string;
	/** The leading character the marker ink is chosen by; `""` on a blank line. */
	marker: string;
	kind: DiffLineKind;
};

export type DiffBody = {
	lines: DiffBodyLine[];
	/** Lines the cap hid, for the overflow marker. */
	hidden: number;
};

/**
 * The body the expanded row paints: header-stripped, rstripped, classified and
 * capped, so the component below stays presentational.
 *
 * The cap counts lines AFTER the header strip, as the terminal does, and the
 * overflow count is the number of remaining lines — including the producer's
 * own trailing `…` on a diff truncated at 200, which is ordinary content line
 * 201 rather than this marker. That is why the two are separate ideas here: the
 * producer's `…` is a dim line inside the body, this one is the dim line below
 * it that says how much is not shown.
 */
export function diffBody(diff: readonly string[]): DiffBody {
	const stripped = stripDiffHeader(diff);
	const shown = stripped.slice(0, DIFF_EXPAND_MAX_LINES);
	return {
		lines: shown.map((raw) => {
			const text = rstrip(raw);
			return { text, marker: text.slice(0, 1), kind: diffLineKind(text) };
		}),
		hidden: stripped.length - shown.length,
	};
}

/**
 * The overflow marker, spelled exactly as the terminal spells it.
 *
 * `f"… {hidden} more diff line{'s' if hidden != 1 else ''}"`
 * (tool_card.py:2222-2223) — including the singular case, because "… 1 more
 * diff lines" is the kind of copy a reader notices instead of the number.
 */
export function diffOverflowLabel(hidden: number): string {
	return `… ${hidden} more diff line${hidden === 1 ? "" : "s"}`;
}
