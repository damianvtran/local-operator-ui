import { BrowserHostError } from "../errors";
import { sleep } from "../policy/adapter";
import { type BrowserActionContext, stringParam } from "./context";
import { sendIn } from "./frames";
import { pageOf } from "./gate";
import { CLICK_FUNCTION, resolveNode } from "./input";
import { SELECT_PAGE_SOURCE } from "./page-programs.gen";

/** The page program is injected as SOURCE, not as `selectPage.toString()`: the
 * packaged main bundle is V8 bytecode whose loader runs against a dummy source
 * string, so `toString()` returns that dummy in a built app (measured, and the
 * reason `select` could not change a native `<select>` at all). The readable
 * implementation is `page-programs/select-page.ts`; the string is generated
 * from it by `scripts/generate-page-programs.mjs`. Re-exported because the unit
 * fixture executes exactly the function the string was captured from. */
export { selectPage } from "./page-programs/select-page";

type PageResult = {
	status: string;
	kind?: "native" | "aria";
	multiple?: boolean;
	selected?: Array<{ index: number; label: string; value: string }>;
	verified?: boolean;
	available?: unknown[];
};

/** Same ownership/document lane as click. Selection handlers may navigate, so the
 * host's NAVIGATING_ACTIONS entry gives success AND throw paths landing checks and
 * restoration. No native popup and no OS/window focus: native uses DOM setters;
 * custom widgets use the same fixed pointer sequence as click on the resolved node.
 */
export async function select(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const target = stringParam(params, "selector") || stringParam(params, "ref");
	const options = params.options;
	if (
		!target ||
		!Array.isArray(options) ||
		options.some(
			(o) =>
				typeof o !== "string" &&
				!(typeof o === "number" && Number.isSafeInteger(o) && o >= 0),
		)
	) {
		throw new BrowserHostError(
			"internal",
			"select needs a selector and options (strings or non-negative integer indexes)",
			{ reason: "invalid_arguments" },
		);
	}
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	// Hidden native selects have no layout box but can still accept DOM selection;
	// no geometry/native popup is required. ARIA's click below uses its page box.
	const resolve = () => resolveNode(ctx, record, target, { scroll: false });
	let node = await resolve();
	const run = async (mode: string, choices = options): Promise<PageResult> => {
		const out = await sendIn<{ result?: { value?: PageResult } }>(
			ctx,
			contents,
			node.sessionId,
			"Runtime.callFunctionOn",
			{
				objectId: node.objectId,
				// Committed source, never `.toString()`: see the import's note.
				functionDeclaration: SELECT_PAGE_SOURCE,
				arguments: [{ value: mode }, { value: choices }],
				returnByValue: true,
			},
		);
		const result = out.result?.value;
		if (!result)
			throw new BrowserHostError(
				"element_not_found",
				"selection target disappeared during selection",
			);
		if (result.status !== "ready")
			throw new BrowserHostError(
				"element_not_found",
				`select refused: ${result.status}`,
				{
					reason: result.status,
					...(result.available ? { available: result.available } : {}),
				},
			);
		return result;
	};
	// Detect native without requiring an open listbox for a closed ARIA trigger.
	const inspect = await sendIn<{ result?: { value?: boolean } }>(
		ctx,
		contents,
		node.sessionId,
		"Runtime.callFunctionOn",
		{
			objectId: node.objectId,
			functionDeclaration: "function () { return this.tagName === 'SELECT'; }",
			returnByValue: true,
		},
	);
	if (inspect.result?.value === true) {
		await run("apply");
		await sleep(100);
		node = await resolve(); // Frameworks may replace the select in their change handler.
		const result = await run("read");
		ctx.registry.touch(record);
		return {
			selected: result.selected,
			kind: "native",
			verified: result.verified,
			...pageOf(record.view),
		};
	}
	await run("trigger"); // Refuse a disabled or non-select trigger before dispatching.
	if (options.length !== 1)
		throw new BrowserHostError(
			"element_not_found",
			"ARIA selection needs exactly one option",
			{ reason: "single_select" },
		);
	// Never force attributes on a custom widget; its own click handlers own state.
	await sendIn(ctx, contents, node.sessionId, "Runtime.callFunctionOn", {
		objectId: node.objectId,
		functionDeclaration: CLICK_FUNCTION,
		returnByValue: true,
	});
	await sleep(100);
	node = await resolve();
	const description = await run("describe");
	if (description.multiple || options.length !== 1)
		throw new BrowserHostError(
			"element_not_found",
			"ARIA selection currently needs one option on a single-select widget",
			{ reason: "single_select" },
		);
	const before = await run("read"); // Validate matching and disabled options before clicking.
	const chosen = await sendIn<{ result?: { objectId?: string } }>(
		ctx,
		contents,
		node.sessionId,
		"Runtime.callFunctionOn",
		{
			objectId: node.objectId,
			functionDeclaration: SELECT_PAGE_SOURCE,
			arguments: [{ value: "option" }, { value: options }],
			returnByValue: false,
		},
	);
	if (!chosen.result?.objectId)
		throw new BrowserHostError(
			"element_not_found",
			"the matched option disappeared",
		);
	await sendIn(ctx, contents, node.sessionId, "Runtime.callFunctionOn", {
		objectId: chosen.result.objectId,
		functionDeclaration: CLICK_FUNCTION,
		returnByValue: true,
	});
	await sleep(100);
	node = await resolve();
	// A closed popup may remove its options. In that case selection is NOT proven:
	// report the matched facts only with verified:false, never invent ARIA state.
	let result: PageResult;
	try {
		result = await run("read");
	} catch (error) {
		// Missing popup after the click is expected for many widgets. Do not hide
		// transport/context failures: the host's throwing-path authorization must
		// still judge a navigation before propagating those errors.
		if (
			!(error instanceof BrowserHostError) ||
			error.code !== "element_not_found"
		)
			throw error;
		const text = await sendIn<{ result?: { value?: string } }>(
			ctx,
			contents,
			node.sessionId,
			"Runtime.callFunctionOn",
			{
				objectId: node.objectId,
				functionDeclaration:
					"function () { return (this.value || this.textContent || '').trim(); }",
				returnByValue: true,
			},
		);
		return {
			selected: before.selected,
			kind: "aria",
			verified:
				before.selected?.length === 1 &&
				text.result?.value === before.selected[0].label,
			...pageOf(record.view),
		};
	}
	ctx.registry.touch(record);
	return {
		selected: result.selected,
		kind: "aria",
		verified: result.verified,
		...pageOf(record.view),
	};
}
