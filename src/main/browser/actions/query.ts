import { BrowserHostError } from "../errors";
import { SCRIPTING_DEADLINE_MS, deadline } from "../vendor/driver/deadline";
import { type BrowserActionContext, numberParam, stringParam } from "./context";
import { pageOf } from "./gate";
import { QUERY_SOURCE } from "./geometry-sources.gen";
import { INVALID_SELECTOR, ISOLATED_WORLD_ID } from "./page";

/**
 * `query`: CSS in, bounded element descriptors out.
 *
 * The measured incident's most useful unanswered question — "what is the
 * id/name/role of the checkbox next to 'Active'?" — had no route: `read`
 * returns text without attributes, `snapshot` returns an AX tree, and there is
 * no `eval`. This answers it without any write, any navigation or any
 * caller-supplied code: the selector is an ARGUMENT to
 * `document.querySelectorAll`, and the page function
 * (`vendor/driver/element-query.ts`, captured as source by
 * `scripts/generate-geometry-sources.mjs`) is the authority for every cap.
 *
 * WHY SOURCE AND NOT `toString()`: the packaged main bundle is V8 bytecode and
 * its loader runs against a dummy source string, so `fn.toString()` returns
 * that dummy text in a built app — measured, and the reason
 * `geometry-sources.gen.ts` exists at all. This follows the same transport as
 * the three structured reads, in the same isolated world (999), because a query
 * is a read by construction.
 *
 * THE ONE RULE THE PAGE FUNCTION ENFORCES THAT THIS LAYER CANNOT: a password
 * input's value is never returned. It is pinned by
 * `extension/tests/element-query.test.mjs` and by this repo's
 * `scripts/check-geometry-sources.test.mjs` pinning the source it was captured
 * from — so a change to that rule cannot ship without the regenerated source.
 */

/** The wire-shape default and cap the extension's handler applies; the page
 *  function re-applies both (1..50) and is the authority. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function query(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const selector = stringParam(params, "selector");
	if (!selector) {
		// Same refusal, same words as the extension: a query with no selector is
		// a whole-page dump, which is what `snapshot` is for.
		throw new BrowserHostError("element_not_found", "selector is required");
	}
	const requested = numberParam(params, "limit") ?? DEFAULT_LIMIT;
	const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(requested)));

	const code = `(${QUERY_SOURCE})(${JSON.stringify(selector)}, ${JSON.stringify(limit)})`;
	let result: unknown;
	try {
		result = await deadline(
			record.view.webContents.executeJavaScriptInIsolatedWorld(
				ISOLATED_WORLD_ID,
				[{ code }],
			),
			SCRIPTING_DEADLINE_MS,
			`query(${record.tabId})`,
		);
	} catch (error) {
		// A selector that is not valid CSS rejects INSIDE the page function; it is
		// the caller's mistake, and it must read as the typed refusal the other
		// page-script reads answer, never `internal`.
		if (error instanceof Error && INVALID_SELECTOR.test(error.message)) {
			throw new BrowserHostError(
				"element_not_found",
				`selector ${selector} is not valid`,
			);
		}
		throw error;
	}
	if (typeof result !== "object" || result === null) {
		throw new BrowserHostError(
			"internal",
			"the page returned no structured query result",
		);
	}
	// The page function REPORTS a bad selector as a value, because a thrown error
	// does not survive this primitive's wrapper (measured against the built app:
	// the renderer answered "Script failed to execute", losing the page's own
	// message). This is where that value becomes the caller's typed refusal, in
	// the words the other page-script reads use.
	if ((result as { error?: string }).error === "invalid_selector") {
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} is not valid`,
		);
	}
	ctx.registry.touch(record);
	// Zero matches is an ANSWER (`count: 0`, empty list), not an error: "this
	// selector matches nothing" is the answer to the question that was asked.
	return { ...(result as Record<string, unknown>), ...pageOf(record.view) };
}
