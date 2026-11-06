import { BrowserHostError } from "../errors";
import { type BrowserActionContext, stringParam } from "./context";
import { sendIn } from "./frames";
import { pageOf } from "./gate";
import { resolveNode } from "./input";
import { SETVALUE_PAGE_SOURCE } from "./page-programs.gen";

/**
 * `setvalue`: write ONE form control's value, then read it back.
 *
 * WHY THIS EXISTS, in the incident's words: an agent driving a settings form
 * could click a native `<select>` and type into a text field, and had no way to
 * fill a date input (whose value is an ISO string, not keystrokes), a masked
 * widget, or a `<select>` at all — `select` operates the OPTION, and needs the
 * option's label or index, which is the wrong tool when the caller already
 * knows the value it wants. This is the write the form-fill path was missing.
 *
 * WHAT IT IS NOT: not `eval`, and not a second input stack. The page program
 * (`page-programs/setvalue-page.ts`, injected as committed source) is fixed —
 * the caller supplies the VALUE as a CDP argument and never any source — and it
 * runs in the resolved element's own frame in the session's own tab through the
 * same surface, registry and frame plumbing `click` and `select` use. It cannot
 * reach a privileged context, cannot navigate, issues no network request, and
 * touches no node outside the target.
 *
 * WHY SOURCE AND NOT `.toString()`: the packaged main bundle is V8 bytecode and
 * its loader runs against a dummy source string, so `toString()` returns that
 * dummy in a shipped app — measured, and the reason `select` was inert on
 * 2026-11-06. Every page program this host injects now rides the generated
 * constants; `check-page-programs.test.mjs` re-derives them and a scan there
 * fails a NEW `functionDeclaration` fed a `.toString()`.
 *
 * THE READ-BACK IS THE PROOF. The program returns the value it read after
 * dispatching `input` and `change`, so a caller verifies state without a
 * screenshot. `verified: false` is a REAL answer (a date field rejects an
 * unparsable string by keeping ""), not an internal error.
 */

/** The shape `page-programs/setvalue-page.ts` answers with. */
type PageResult = {
	status: string;
	kind?: "input" | "textarea" | "select";
	type?: string;
	value?: string;
	verified?: boolean;
	matched?: { index: number; label: string; value: string };
	available?: unknown[];
	tag?: string;
	/** A password field: `value` is deliberately absent, `verified` is honest. */
	redacted?: boolean;
	/** Why a value did not stick, and the format the control wanted. */
	input_type?: string;
	expected?: string;
};

/**
 * WHAT THIS ACTION RETURNS — the fields, so the next host and the caller's
 * renderer read the same contract:
 *
 *   `{value, kind, verified, url, title}` is the shared shape (the wire table in
 *   the sibling `local-operator` PR owns it). Two desktop-only extensions ride
 *   on top and are named here because they are additive and nobody else's to
 *   document: `input_type` (the DOM input type the write went through, so a
 *   caller can tell a date field from a text one) and `matched` (the option a
 *   `<select>` resolved to: `{index, label, value}`, the same triple `select`
 *   returns). A caller that ignores both is unaffected.
 *
 *   `value` is ABSENT for `<input type=password>`: the program reads it back for
 *   honesty but never returns a credential, and `verified` still answers whether
 *   the write stuck. Nothing on this path may put a secret in a transcript.
 */

/**
 * Same document/ownership lane as `select`, and for the same reason: a
 * framework's `change` handler is arbitrary page code, and an auto-submitting
 * form turns a write into a navigation. `host.ts` puts this action in
 * DOCUMENT_SCOPED, NAVIGATING_ACTIONS and TAB_SCOPED, and deliberately NOT in
 * NAVIGATION_ACTIONS — the write itself fetches nothing, so arming the per-hop
 * `Fetch` gate around it would fail the page's own subresources for no consent
 * gain.
 */
export async function setvalue(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const target = stringParam(params, "selector") || stringParam(params, "ref");
	const text = params.text;
	// `text` is the value, and an EMPTY string is a legitimate one (clearing a
	// field), so presence is checked by type rather than by truthiness — the
	// same distinction `type` makes. The refusal is `internal` +
	// `invalid_arguments`, matching `select`'s own argument refusal: this is a
	// caller mistake, not a page state.
	if (!target || typeof text !== "string") {
		throw new BrowserHostError(
			"internal",
			"setvalue needs a selector and a text value",
			{ reason: "invalid_arguments" },
		);
	}
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	// No geometry is needed: a hidden or off-screen control still holds a value,
	// so this never scrolls the page under the user's cursor.
	const node = await resolveNode(ctx, record, target, { scroll: false });
	const out = await sendIn<{ result?: { value?: PageResult } }>(
		ctx,
		contents,
		node.sessionId,
		"Runtime.callFunctionOn",
		{
			objectId: node.objectId,
			functionDeclaration: SETVALUE_PAGE_SOURCE,
			arguments: [{ value: text }],
			returnByValue: true,
		},
	);
	const result = out.result?.value;
	if (!result)
		throw new BrowserHostError(
			"element_not_found",
			"the setvalue target disappeared before it could be written",
		);
	if (result.status !== "ready") {
		// `element_not_found` with a typed `reason`, exactly as `select` refuses:
		// the wire's ErrorCode vocabulary is closed, and a caller branches on
		// `data.reason` (disabled, readonly, file_input, not_a_form_control,
		// not_a_value_control, value_rejected, option_not_found,
		// option_ambiguous) rather than on prose. Two of those refusals name the
		// verb or the format that would work, because "refused" alone leaves the
		// caller guessing.
		const message =
			result.status === "not_a_value_control"
				? "setvalue cannot toggle a checkbox or radio: its state is checked, not a value. Use click to toggle it."
				: result.status === "value_rejected"
					? `setvalue refused: ${result.status} — this ${result.input_type} field did not take the value; it accepts ${result.expected}`
					: `setvalue refused: ${result.status}`;
		throw new BrowserHostError("element_not_found", message, {
			reason: result.status,
			...(result.available ? { available: result.available } : {}),
			...(result.tag ? { tag: result.tag } : {}),
			...(result.input_type ? { input_type: result.input_type } : {}),
			...(result.expected ? { expected: result.expected } : {}),
		});
	}
	ctx.registry.touch(record);
	return {
		kind: result.kind,
		// A password field answers without its value; everything else answers with
		// the read-back, always present so a caller never has to distinguish
		// "absent" from "empty".
		...(result.redacted ? {} : { value: result.value ?? "" }),
		verified: result.verified ?? false,
		...(result.type ? { input_type: result.type } : {}),
		...(result.matched ? { matched: result.matched } : {}),
		...pageOf(record.view),
	};
}
