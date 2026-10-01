import { BrowserHostError } from "../errors";
import type { TabRecord } from "../registry";
import { SCRIPTING_DEADLINE_MS, deadline } from "../vendor/driver/deadline";
import * as geometryDriver from "../vendor/driver/geometry-read";
import { type BrowserActionContext, numberParam, stringParam } from "./context";
import { pageOf } from "./gate";
import { INVALID_SELECTOR, ISOLATED_WORLD_ID } from "./page";

/**
 * The structured reads: `styles`, `hit_test`, `ancestors`.
 * Design: docs/design/ui-browser-tab.md 4 (the matrix rows), 12.1 (the vendored
 * driver functions), 6.4 (a read never locks the tab).
 *
 * WHY THESE RUN THE VENDORED DRIVER FUNCTIONS rather than host-local code: the
 * extension serves the same three methods, and the app and the extension must
 * answer them with the same arithmetic — the same caps, the same rounding, the
 * same property lists. `extension/src/driver/geometry-read.ts` is the one
 * implementation, vendored into `vendor/driver/` under the PROVENANCE pin, and
 * this module only carries the function across the world boundary.
 *
 * WHY `({fn}.toString())(...)` AND NEVER A BUILT STRING: Electron's scripting
 * primitive takes source, not a function reference (the extension passes
 * `chrome.scripting.executeScript({func})`), so the function travels as its own
 * source and every argument is JSON-encoded data. Nothing call-supplied — a
 * selector with quotes in it, a number, a property list — is ever concatenated
 * into executable code; the same posture `read` states for its selector.
 *
 * WHY THE SAME ISOLATED WORLD AS `read`: these read the page the way `read`
 * does, and the main world would let the page observe the agent's reads and
 * interfere with them. 999 is `page.ts`'s ISOLATED_WORLD_ID, imported rather
 * than re-spelled so the two families cannot drift apart.
 *
 * WHERE THE BOUNDS LIVE: every output bound (five matches, thirty properties,
 * eight elements, the sixteen-step chain, two-decimal rects) happens INSIDE the
 * page functions, so the result is bounded at the source. What this module adds
 * on top is only the WIRE-SHAPE parity guard the extension's command layer
 * applies before its own page call — a required selector, a numeric point, a
 * depth clamped to [1, 16], string-only property extras — mirrored so the two
 * hosts refuse the same frames with the same words. The page function remains
 * the authority for all of it and re-checks each bound.
 */

/** One of the vendored page functions. Its source is what crosses the boundary,
 * so the signature here is deliberately the loosest one the functions compose
 * with: the real request/response detail lives in the vendored file. */
type PageFunction = (...args: never[]) => unknown;

/** A wire-shape-checked argument, JSON-encoded on its way into the page. */
type Arg = string | number | string[];

/** The wire-shape cap the extension applies to caller-requested extras before
 * the page function dedupes them against its defaults and caps the combined
 * list at thirty. Mirrored, not re-derived. */
const MAX_REQUESTED_PROPERTIES = 20;

/** The chain bound applied when `depth` is absent, and the hard cap, both
 * mirrored from the extension's handler (the page function re-applies them). */
const DEFAULT_DEPTH = 12;
const MAX_DEPTH = 16;

/**
 * Run one fixed function in the tab's isolated world, with arguments passed as
 * JSON data.
 *
 * The deadline is `read`'s: these run page script through the same primitive,
 * so they share its risk profile and its 20 s daemon budget.
 */
async function runFixed(
	record: TabRecord,
	fn: PageFunction,
	args: Arg[],
	label: string,
): Promise<unknown> {
	const code = `(${fn.toString()})(${args
		.map((arg) => JSON.stringify(arg))
		.join(", ")})`;
	return await deadline(
		record.view.webContents.executeJavaScriptInIsolatedWorld(
			ISOLATED_WORLD_ID,
			[{ code }],
		),
		SCRIPTING_DEADLINE_MS,
		label,
	);
}

/** Re-raise an isolated-world rejection as the typed refusal `read` already
 * raises for a bad selector, and leave everything else untouched. */
function selectorError(selector: string, error: unknown): unknown {
	if (error instanceof Error && INVALID_SELECTOR.test(error.message)) {
		return new BrowserHostError(
			"element_not_found",
			`selector ${selector} is not valid`,
		);
	}
	return error;
}

/**
 * The structured result, required to be an object.
 *
 * The three reads are structured BY CONSTRUCTION, so a bare value here is the
 * driver or the world misbehaving — the functions answer `null` for "nothing
 * matched" and an object otherwise, and a string is neither. A typed `internal`
 * beats spreading it into the answer the session will try to read as
 * `{count, ...}`.
 */
function structuredResult(
	name: string,
	result: unknown,
): Record<string, unknown> {
	if (typeof result !== "object" || result === null) {
		throw new BrowserHostError(
			"internal",
			`the page returned no structured ${name} result`,
		);
	}
	return result as Record<string, unknown>;
}

/** The selector both selector-keyed reads require, refused the way the
 * extension's command layer refuses it. */
function requiredSelector(params: Record<string, unknown>): string {
	const selector = stringParam(params, "selector");
	if (!selector) {
		throw new BrowserHostError("element_not_found", "selector is required");
	}
	return selector;
}

/** Caller-requested extra computed-style properties, string-only, capped at
 * twenty — the same wire-shape guard the extension applies before its own
 * page call. The page function dedupes against its defaults, caps the
 * combined list at thirty, and is the authority for both. */
function requestedProperties(params: Record<string, unknown>): string[] {
	if (!Array.isArray(params.properties)) return [];
	return params.properties
		.filter((entry): entry is string => typeof entry === "string")
		.slice(0, MAX_REQUESTED_PROPERTIES);
}

/** `styles`: the bounding rect, computed styles and inline custom properties of
 * up to five matches of `selector`. */
export async function styles(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const selector = requiredSelector(params);
	const properties = requestedProperties(params);
	let result: unknown;
	try {
		result = await runFixed(
			record,
			geometryDriver.readStyles,
			[selector, properties],
			`styles(${selector})`,
		);
	} catch (error) {
		throw selectorError(selector, error);
	}
	if (result === null || result === undefined) {
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched nothing`,
		);
	}
	ctx.registry.touch(record);
	return { ...structuredResult("styles", result), ...pageOf(record.view) };
}

/** `hit_test`: the elements at viewport point (x, y), topmost first, as
 * `document.elementsFromPoint` sees them. A point with no element on it is the
 * function's `null`, raised as `element_not_found` like the extension does. */
export async function hitTest(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const x = numberParam(params, "x");
	const y = numberParam(params, "y");
	if (x === undefined || y === undefined) {
		// The Python tool refuses this before the wire; this is the last gate for
		// a frame from a peer whose own validation is missing or older.
		throw new BrowserHostError(
			"internal",
			"'hit_test' needs numeric x and y (viewport coordinates)",
		);
	}
	const result = await runFixed(
		record,
		geometryDriver.hitTest,
		[x, y],
		`hit_test(${x}, ${y})`,
	);
	if (result === null || result === undefined) {
		throw new BrowserHostError(
			"element_not_found",
			`no element at point (${x}, ${y})`,
		);
	}
	ctx.registry.touch(record);
	return {
		...structuredResult("hit_test", result),
		...pageOf(record.view),
	};
}

/** `ancestors`: the chain from `selector` upward to the document element
 * (inclusive), each element with its rect and the layout-relevant styles. */
export async function ancestors(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const selector = requiredSelector(params);
	// Pre-clamped the way the extension pre-clamps it, so the value on the wire
	// is already sane; the page function re-applies both the default and the cap.
	const raw = numberParam(params, "depth");
	const depth = Math.max(
		1,
		Math.min(MAX_DEPTH, raw === undefined ? DEFAULT_DEPTH : Math.floor(raw)),
	);
	let result: unknown;
	try {
		result = await runFixed(
			record,
			geometryDriver.ancestors,
			[selector, depth],
			`ancestors(${selector})`,
		);
	} catch (error) {
		throw selectorError(selector, error);
	}
	if (result === null || result === undefined) {
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched nothing`,
		);
	}
	ctx.registry.touch(record);
	return {
		...structuredResult("ancestors", result),
		...pageOf(record.view),
	};
}
