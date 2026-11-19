import type { ErrorInfo } from "react";

/**
 * The ONE line an error boundary writes when it catches, as a single string.
 *
 * WHY A STRING AND NOT `console.error(label, error, info)`. A shipped build has
 * no devTools, so the only durable copy of a renderer error is the line the
 * main process forwards from `webContents`' `console-message` event into
 * `backend-service.log` (`src/main/index.ts`). That event carries Chromium's
 * flattened message text, not the arguments: an `Error` collapses to its
 * `toString()` (no stack) and React's `ErrorInfo` to `[object Object]`, so the
 * component stack - the one thing that names WHICH component failed - was lost.
 * Incident 2026-11-10 (v0.53.0): a Team Bridge crash loop logged only
 * "Minified React error #185 ... [object Object]" three times, with no way to
 * tell which component's update loop it was. Formatting here, before the
 * console, is what survives that flattening.
 *
 * WHAT IT CARRIES. The error's own stack (its first line is the message) and
 * React's component stack. In a production build the component names are
 * minified, but each frame still carries its bundle location, which maps back
 * to source; in development they are the real names. A thrown value that is
 * not an `Error` is described by its type tag and top-level key NAMES only,
 * never its contents: this line lands in a file users send us, and an
 * arbitrary object (a response, a payload) may carry data the console line
 * never put on disk before - Chromium flattened it to `[object Object]`.
 *
 * NEVER THROWS (agent review round 1, F1). This runs inside the boundary's
 * own error path: a throw here replaces the original error and, at the app
 * root where nothing sits above the boundary, unmounts the whole tree. Every
 * read of the thrown value can run user code (getters, `toString`, a revoked
 * Proxy), so the whole body is guarded and falls back to a fixed line.
 *
 * BOUNDED (F2). Each part is capped separately, so an enormous message cannot
 * push the component stack - the part this exists for - out of the line. The
 * caps are sized from frame arithmetic, not a measured production stack (none
 * was available): React's component stack is one ~60-150 character frame per
 * ancestor, and this app's deepest trees (shell, providers, route, page, list,
 * row, popover) are on the order of 100 ancestors, about 15 KB, so 24 KB holds
 * a real one with room to spare. 8 KB holds a JavaScript stack (V8 keeps 10
 * frames by default) plus a long message. 32 KB per line in total keeps one
 * catch far from the logger's 10 MB rotation.
 */
export const BOUNDARY_ERROR_CAP = 8 * 1024;
export const BOUNDARY_COMPONENT_STACK_CAP = 24 * 1024;
const LABEL = "Error caught by ErrorBoundary:";
const UNFORMATTABLE = `${LABEL} (unformattable error)`; // i18n: ignore diagnostic log line for backend-service.log, never rendered copy
/** Key names past this many are summarised by count: the names identify the
 * shape, and a giant object's key list is as unbounded as its contents. */
const KEY_NAMES_SHOWN = 20;

export function formatBoundaryError(
	error: unknown,
	info: Pick<ErrorInfo, "componentStack"> | null | undefined,
): string {
	try {
		const head = cap(describeThrown(error), BOUNDARY_ERROR_CAP);
		const componentStack = readComponentStack(info);
		return componentStack
			? `${LABEL} ${head}\nComponent stack:\n    ${cap(componentStack, BOUNDARY_COMPONENT_STACK_CAP)}`
			: `${LABEL} ${head}\nComponent stack: (none reported)`;
	} catch {
		return UNFORMATTABLE;
	}
}

function describeThrown(error: unknown): string {
	if (error instanceof Error) {
		let stack = "";
		try {
			stack = typeof error.stack === "string" ? error.stack : "";
		} catch {
			// A throwing `stack` getter: the message alone still says something.
		}
		const message = safeString(error.message);
		// Some engines omit the message from `stack`; keep it either way.
		if (stack?.includes(message)) return stack;
		return `${safeString(error)}\n${stack}`.trimEnd();
	}
	if (error !== null && typeof error === "object") return describeObject(error);
	// Primitives, symbols and functions: `String` names them (`Symbol(x)`), where
	// `JSON.stringify` returned `undefined` (F4).
	return safeString(error);
}

/** Type tag and top-level key names, never values (F3). */
function describeObject(value: object): string {
	const tag = Object.prototype.toString.call(value);
	let keys: string[];
	try {
		keys = Object.keys(value);
	} catch {
		return `${tag} (keys unreadable)`; // i18n: ignore diagnostic log line for backend-service.log, never rendered copy
	}
	if (keys.length === 0) return `${tag} (no keys)`; // i18n: ignore diagnostic log line for backend-service.log, never rendered copy
	const shown = keys.slice(0, KEY_NAMES_SHOWN).join(", ");
	const more =
		keys.length > KEY_NAMES_SHOWN
			? `, +${keys.length - KEY_NAMES_SHOWN} more`
			: "";
	return `${tag} keys: ${shown}${more}`; // i18n: ignore diagnostic log line for backend-service.log, never rendered copy
}

function readComponentStack(
	info: Pick<ErrorInfo, "componentStack"> | null | undefined,
): string {
	try {
		const stack = info?.componentStack;
		return typeof stack === "string" ? stack.trim() : "";
	} catch {
		return "";
	}
}

function safeString(value: unknown): string {
	try {
		return String(value);
	} catch {
		try {
			return Object.prototype.toString.call(value);
		} catch {
			return "(unprintable)";
		}
	}
}

function cap(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}...[truncated ${text.length - limit} chars]`; // i18n: ignore diagnostic log line for backend-service.log, never rendered copy
}
