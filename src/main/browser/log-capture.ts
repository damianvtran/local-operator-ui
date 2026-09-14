import type { LogEntry } from "./protocol";

/**
 * Per-tab console/runtime log capture for the `logs` action.
 *
 * Ported from `extension/src/log-capture.ts` in `damianvtran/local-operator` at
 * `d383e6bfe`, including the caps and the formatter rules, because those are the
 * parts that exist for reasons rather than for shape. The one substitution is
 * mechanical: the extension routes by `chrome.debugger` events keyed by tabId,
 * this host routes `webContents.debugger` events keyed by webContents id.
 *
 * WHY a ring buffer in the host rather than reading the page: the point of
 * `logs` is to surface real console output AND uncaught exceptions that ALREADY
 * happened, and a page's console history is not readable after the fact. So the
 * `Runtime` and `Log` CDP domains are enabled from the moment a view is driven
 * and three event streams are buffered into one ordered list per tab:
 *   - `Runtime.consoleAPICalled` — every console.log/warn/error/info/debug
 *   - `Runtime.exceptionThrown`  — uncaught exceptions (the debugging payoff)
 *   - `Log.entryAdded`           — browser-level messages (network, security,
 *                                  deprecations) the page never sees
 *
 * CONSTRAINTS:
 *   - The buffer lives in the main process and dies with the tab (and with the
 *     app). That is honest: `logs` is defined as "since this surface opened",
 *     and closing the tab tears the debugger session down anyway.
 *   - Capped two ways (entry count AND total bytes) so a page in a tight
 *     console-spam loop cannot grow the main process without bound; oldest
 *     entries are dropped first, which is the order the tool wants.
 *   - NO page-provided string is ever evaluated. We read structured CDP event
 *     payloads and stringify argument previews with a fixed formatter, keeping
 *     the no-remote-code posture the rest of the driver holds.
 */

/** Keep the newest N entries; a debugging read wants recent output, and an
 * unbounded buffer on a noisy page is a memory leak in a long-lived process. */
const MAX_ENTRIES = 200;
/** Independent byte ceiling: 200 short lines is nothing, but 200 lines each
 * carrying a stringified megabyte object would still blow up. */
const MAX_BYTES = 256 * 1024;
/** One argument preview is capped so a single huge logged object cannot dominate
 * the buffer; the tool truncates the whole response again on the Python side. */
const MAX_ARG_CHARS = 2000;

interface Buffer {
	entries: LogEntry[];
	bytes: number;
}

const buffers = new Map<number, Buffer>();

export function hasLogCapture(webContentsId: number): boolean {
	return buffers.has(webContentsId);
}

export function startLogCapture(webContentsId: number): void {
	if (!buffers.has(webContentsId)) {
		buffers.set(webContentsId, { entries: [], bytes: 0 });
	}
}

export function stopLogCapture(webContentsId: number): void {
	buffers.delete(webContentsId);
}

/** The buffered entries, newest last, optionally filtered by level and capped. */
export function drainLogs(
	webContentsId: number,
	options: { level?: string; limit?: number } = {},
): LogEntry[] {
	const buffer = buffers.get(webContentsId);
	if (!buffer) return [];
	const level = options.level?.trim().toLowerCase() ?? "";
	const filtered = level
		? buffer.entries.filter((entry) => entry.level === level)
		: buffer.entries;
	const limit =
		typeof options.limit === "number" &&
		Number.isFinite(options.limit) &&
		options.limit > 0
			? Math.floor(options.limit)
			: filtered.length;
	// The newest `limit` entries, still newest-last.
	return filtered.slice(Math.max(0, filtered.length - limit));
}

function bufferFor(webContentsId: number): Buffer {
	let buffer = buffers.get(webContentsId);
	if (!buffer) {
		buffer = { entries: [], bytes: 0 };
		buffers.set(webContentsId, buffer);
	}
	return buffer;
}

function push(webContentsId: number, entry: LogEntry): void {
	const buffer = bufferFor(webContentsId);
	buffer.entries.push(entry);
	buffer.bytes += entry.text.length;
	while (buffer.entries.length > MAX_ENTRIES || buffer.bytes > MAX_BYTES) {
		const dropped = buffer.entries.shift();
		if (!dropped) break;
		buffer.bytes -= dropped.text.length;
	}
}

/** Normalize a CDP console API `type` to the tool's level vocabulary. */
function levelForConsole(type: unknown): string {
	switch (type) {
		case "error":
		case "assert":
			return "error";
		case "warning":
			return "warning";
		case "info":
			return "info";
		case "debug":
			return "log";
		default:
			return "log";
	}
}

/** Normalize a CDP `Log.entryAdded` level to the tool vocabulary. */
function levelForLogEntry(level: unknown): string {
	switch (level) {
		case "error":
			return "error";
		case "warning":
			return "warning";
		case "info":
			return "info";
		default:
			return "log";
	}
}

/** Render a `Runtime.RemoteObject` argument to a short string WITHOUT evaluating
 * anything: CDP already sent a value or a preview, and only those fields are
 * read. */
function renderArg(arg: Record<string, unknown> | undefined): string {
	if (!arg) return "";
	if (arg.type === "string") return String(arg.value ?? "");
	if ("value" in arg && arg.value !== undefined) return String(arg.value);
	if (typeof arg.description === "string") return arg.description;
	if (arg.type === "undefined") return "undefined";
	if (arg.subtype === "null") return "null";
	return String(arg.type ?? "");
}

function clip(text: string): string {
	return text.length > MAX_ARG_CHARS
		? `${text.slice(0, MAX_ARG_CHARS)}…`
		: text;
}

interface StackTraceLike {
	callFrames?: Array<{ url?: string; lineNumber?: number }>;
}

function topFrame(stackTrace: unknown): { url: string; line: number } {
	const frames = (stackTrace as StackTraceLike | undefined)?.callFrames;
	const frame = frames?.[0];
	return {
		url: typeof frame?.url === "string" ? frame.url : "",
		line: typeof frame?.lineNumber === "number" ? frame.lineNumber : 0,
	};
}

/**
 * The single debugger event router.
 *
 * `webContents.debugger` delivers every domain event for a driven view, so this
 * routes by the source id into the right buffer and ignores events for views it
 * is not capturing — the same shape as the extension's `onEvent`, including the
 * refusal to interpret an event for a tab it does not hold.
 */
export function routeDebuggerEvent(
	webContentsId: number,
	method: string,
	rawParams?: object,
): void {
	if (!buffers.has(webContentsId)) return;
	const params = (rawParams ?? {}) as Record<string, unknown>;

	if (method === "Runtime.consoleAPICalled") {
		const args = Array.isArray(params.args)
			? (params.args as Record<string, unknown>[])
			: [];
		const text = clip(args.map(renderArg).join(" ").trim());
		const frame = topFrame(params.stackTrace);
		push(webContentsId, {
			level: levelForConsole(params.type),
			text,
			source: "console",
			url: frame.url,
			line: frame.line,
			timestamp:
				typeof params.timestamp === "number" ? params.timestamp : Date.now(),
		});
		return;
	}

	if (method === "Runtime.exceptionThrown") {
		const details = (params.exceptionDetails ?? {}) as Record<string, unknown>;
		// Prefer the thrown value's description (message plus stack); fall back to
		// the bare exception text CDP always provides.
		const exception = (details.exception ?? {}) as Record<string, unknown>;
		const text = clip(
			typeof exception.description === "string" && exception.description
				? exception.description
				: String(details.text ?? "uncaught exception"),
		);
		const frame = topFrame(details.stackTrace);
		push(webContentsId, {
			level: "error",
			text,
			source: "exception",
			url: frame.url || String(details.url ?? ""),
			line: frame.line || Number(details.lineNumber ?? 0),
			timestamp:
				typeof params.timestamp === "number" ? params.timestamp : Date.now(),
		});
		return;
	}

	if (method === "Log.entryAdded") {
		const entry = (params.entry ?? {}) as Record<string, unknown>;
		const text = clip(String(entry.text ?? ""));
		if (!text) return;
		push(webContentsId, {
			level: levelForLogEntry(entry.level),
			text,
			source: "log-entry",
			url: String(entry.url ?? ""),
			line: Number(entry.lineNumber ?? 0),
			timestamp:
				typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
		});
	}
}
