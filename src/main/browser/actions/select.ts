import { BrowserHostError } from "../errors";
import { sleep } from "../policy/adapter";
import { type BrowserActionContext, stringParam } from "./context";
import { sendIn } from "./frames";
import { pageOf } from "./gate";
import { CLICK_FUNCTION, resolveNode } from "./input";

/** Fixed page program, shared by native selection, ARIA discovery and read-back.
 * No caller code: arguments are CDP values. Keep it self-contained so the unit
 * fixture executes exactly the program shipped over Runtime.callFunctionOn.
 * Native setters bypass framework-owned instance properties, then BOTH events
 * announce the change; assigning .value alone is not a controlled-select update.
 * ARIA widgets remain page-owned: we click their real options, never forge their
 * aria-selected state. Scope discovery to the trigger's controlled listbox (or a
 * unique visible one) so a second unrelated menu cannot silently win.
 */
export function selectPage(
	this: Element,
	mode: string,
	requested: Array<string | number>,
): unknown {
	const doc = this.ownerDocument;
	const win = doc.defaultView as Window & typeof globalThis;
	const clip = (text: string) => text.slice(0, 120);
	const native = this instanceof win.HTMLSelectElement;
	const kind = native ? "native" : "aria";
	if (
		!native &&
		!this.matches(
			'[role="combobox"], [role="listbox"], [aria-haspopup="listbox"]',
		)
	) {
		return { status: "not_select" };
	}
	if (
		this.matches(":disabled, [aria-disabled=true]") ||
		this.closest("[inert]")
	)
		return { status: "disabled", kind };
	if (mode === "trigger") return { status: "ready", kind };
	let root: Element = this;
	if (!native && !this.matches('[role="listbox"]')) {
		const ids = (
			this.getAttribute("aria-controls") ||
			this.getAttribute("aria-owns") ||
			""
		)
			.split(/\s+/)
			.filter(Boolean);
		const controlled = ids
			.map((id) => doc.getElementById(id))
			.filter((el): el is HTMLElement => !!el);
		const candidates = controlled.length
			? controlled
			: Array.from(doc.querySelectorAll('[role="listbox"]')).filter(
					(el) => el.getClientRects().length > 0,
				);
		if (candidates.length !== 1) return { status: "listbox_missing", kind };
		root = candidates[0];
	}
	const elements = native
		? Array.from((this as HTMLSelectElement).options)
		: Array.from(root.querySelectorAll('[role="option"]'));
	const facts = elements.map((el, index) => ({
		index,
		label: (native
			? (el as HTMLOptionElement).label
			: el.getAttribute("aria-label") || el.textContent || ""
		).trim(),
		value: native
			? (el as HTMLOptionElement).value
			: el.getAttribute("data-value") || el.getAttribute("value") || "",
	}));
	const available = facts.slice(0, 50).map((fact) => ({
		...fact,
		label: clip(fact.label),
		value: clip(fact.value),
	}));
	const multiple = native
		? (this as HTMLSelectElement).multiple
		: root.getAttribute("aria-multiselectable") === "true";
	if (mode === "describe") return { status: "ready", kind, multiple };
	const indexes: number[] = [];
	for (const item of requested) {
		const needle = typeof item === "string" ? item.trim() : "";
		const found =
			typeof item === "number"
				? facts[item]
				: (facts.find((o) => o.label === needle) ??
					facts.find((o) => o.label.toLowerCase() === needle.toLowerCase()) ??
					facts.find((o) => o.value === item));
		if (!found) return { status: "option_not_found", kind, available };
		if (!indexes.includes(found.index)) indexes.push(found.index);
	}
	if (!multiple && requested.length > 1)
		return { status: "single_select", kind };
	if (!native && requested.length === 0) return { status: "aria_empty", kind };
	if (
		indexes.some(
			(i) =>
				elements[i].matches(":disabled, [aria-disabled=true]") ||
				elements[i].closest("optgroup[disabled], [inert]"),
		)
	)
		return { status: "disabled", kind };
	if (mode === "option") return elements[indexes[0]];
	if (native && mode === "apply") {
		const setSelected = (
			Object.getOwnPropertyDescriptor(
				win.HTMLOptionElement.prototype,
				"selected",
			) as { set: (value: unknown) => void }
		).set;
		if (!multiple) {
			// Bypass React's instance value tracker first; then pin the index too,
			// because different options may legitimately share the same value.
			if (indexes.length)
				(
					Object.getOwnPropertyDescriptor(
						win.HTMLSelectElement.prototype,
						"value",
					) as { set: (value: unknown) => void }
				).set.call(this, facts[indexes[0]].value);
			// Index setter preserves duplicate-valued options and permits clearing.
			const setIndex = (
				Object.getOwnPropertyDescriptor(
					win.HTMLSelectElement.prototype,
					"selectedIndex",
				) as { set: (value: unknown) => void }
			).set;
			setIndex.call(this, indexes[0] ?? -1);
		}
		for (let i = 0; i < elements.length; i += 1)
			setSelected.call(elements[i], indexes.includes(i));
		// Deselecting an option may make a single select auto-pick its first
		// enabled option. Pin the final index AFTER the option setters too.
		if (!multiple)
			(
				Object.getOwnPropertyDescriptor(
					win.HTMLSelectElement.prototype,
					"selectedIndex",
				) as { set: (value: unknown) => void }
			).set.call(this, indexes[0] ?? -1);
		this.dispatchEvent(new win.Event("input", { bubbles: true }));
		this.dispatchEvent(new win.Event("change", { bubbles: true }));
	}
	const active =
		this.getAttribute("aria-activedescendant") ||
		root.getAttribute("aria-activedescendant");
	const selected = facts.filter((o) =>
		native
			? (elements[o.index] as HTMLOptionElement).selected
			: elements[o.index].getAttribute("aria-selected") === "true" ||
				(!!active && elements[o.index].id === active),
	);
	const verified =
		indexes.length === selected.length &&
		indexes.every((i) => selected.some((o) => o.index === i));
	return {
		status: "ready",
		kind,
		multiple,
		selected: native ? selected : indexes.map((i) => facts[i]),
		verified,
		available,
	};
}

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
				functionDeclaration: selectPage.toString(),
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
			functionDeclaration: selectPage.toString(),
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
