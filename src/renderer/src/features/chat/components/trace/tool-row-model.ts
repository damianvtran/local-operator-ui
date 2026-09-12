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
 * The wiring each `bash` result opens with, which the row must not quote.
 *
 * `exit code: N` is the harness's own OUTCOME line, and `--- stdout ---` /
 * `--- stderr ---` are its section markers — so as the object column's stand-in
 * they say the least of anything in the result. The TUI never had to worry
 * about this because it has a dedicated outcome column and never reads the
 * result for an object; a port with no such column inherited the wiring as
 * prose. On a machine where every second row is a `bash` call that is how a
 * transcript came to read forty times `exit code: 0`.
 *
 * Matched after trimming, and the code is optional: a killed call reports
 * `exit code: -9`, and one observed in a real transcript reports a bare
 * `exit code` on its second line. Either way the number is not news — the
 * row's own glyph carries the outcome — so it is never worth the column.
 * Nothing else is filtered: `TIMEOUT after 120.0s (process killed)`, which
 * opens those same results, IS the fact worth standing in.
 */
const OUTPUT_WIRING_LINE =
	/^(?:exit code:?\s*-?\d*|--- (?:stdout|stderr) ---)$/;

/**
 * What the row shows in the object column when the arguments taught it nothing.
 *
 * The first line of the result that actually says something, bounded because
 * the object column is one line: a multi-line result is truncated by CSS
 * anyway, and choosing the line explicitly means the row shows a whole thought
 * rather than a fragment cut mid-word by the layout. The cap matches what fits
 * at the widest sensible column, so a 4 KB result cannot push a long string
 * through the truncation machinery on every render.
 *
 * `null` means the result had nothing to offer and the row should stay empty:
 * "no stand-in exists" is a different claim from "the stand-in is a blank",
 * and only the first lets the caller fall through to its own placeholder.
 */
export function outputFallbackLine(output: string | null): string | null {
	if (!output) return null;
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (OUTPUT_WIRING_LINE.test(trimmed)) continue;
		return trimmed.slice(0, 160);
	}
	return null;
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
	// `<0.1s`, never `0.0s` (`tool_card.py:2615-2623`). Printing `0.0s` for a
	// call that genuinely returned at once reprints the exact string the old
	// fabricated-duration bug produced, so a reader cannot tell a real sub-50 ms
	// call from a row whose duration was lost. The TUI's own reasoning for the
	// spelling: "reads as too fast to measure".
	if (elapsed < 0.05) return "<0.1s";
	if (elapsed < 10) return `${elapsed.toFixed(1)}s`;
	if (elapsed < 60) return `${Math.round(elapsed)}s`;
	return formatDuration(elapsed);
}

/**
 * A byte count at a glance: `812 B`, `12.4 KB`, `1.2 MB`.
 *
 * `_format_bytes` (tool_card.py:360-371), ported because the composing row's
 * number is meant to MOVE: a counter that ticks is what says the model is still
 * dictating, and the app's own spelling — `KiB`, with no step above a kilobyte
 * — spelled a multi-megabyte dictation as `2048.0 KiB`: a number nobody reads
 * at a glance, which is the whole point of the field.
 */
export function formatBytes(count: number): string {
	if (count < 1024) return `${count} B`;
	if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`;
	return `${(count / (1024 * 1024)).toFixed(1)} MB`;
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
