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
 * to source; in development they are the real names.
 *
 * CONSTRAINTS. It must never throw (it runs inside the boundary's error path,
 * where a second throw would mask the first), so anything that is not an Error
 * is stringified defensively. It adds nothing a renderer console did not
 * already receive: no props, no state, no message bodies.
 */
export function formatBoundaryError(
	error: unknown,
	info: Pick<ErrorInfo, "componentStack"> | null | undefined,
): string {
	let head: string;
	if (error instanceof Error) {
		const stack = typeof error.stack === "string" ? error.stack : "";
		// Some engines omit the message from `stack`; keep it either way.
		head = stack.includes(error.message)
			? stack
			: `${String(error)}\n${stack}`.trimEnd();
	} else {
		head = safeString(error);
	}
	const componentStack = info?.componentStack?.trim();
	return componentStack
		? `Error caught by ErrorBoundary: ${head}\nComponent stack:\n    ${componentStack}`
		: `Error caught by ErrorBoundary: ${head}\nComponent stack: (none reported)`;
}

function safeString(value: unknown): string {
	try {
		return typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}
