/** Fixed page program, shared by native selection, ARIA discovery and read-back.
 * No caller code: arguments are CDP values. Keep it self-contained so the unit
 * fixture executes exactly the program shipped over Runtime.callFunctionOn.
 * Native setters bypass framework-owned instance properties, then BOTH events
 * announce the change; assigning .value alone is not a controlled-select update.
 * ARIA widgets remain page-owned: we click their real options, never forge their
 * aria-selected state. Scope discovery to the trigger's controlled listbox (or a
 * unique visible one) so a second unrelated menu cannot silently win.
 *
 * WHY THIS MODULE EXISTS, AND WHY IT NEVER TRAVELS AS `selectPage.toString()`:
 * the packaged main bundle is V8 BYTECODE, and its loader runs the script
 * against a dummy source string, so `Function.prototype.toString()` returns
 * that dummy text in a built app. Measured against the shipped
 * `out/main/index.jsc`: every `select` call answered "selection target
 * disappeared during selection", because CDP was handed the dummy string as
 * the program. The source is therefore captured at GENERATION time by
 * `scripts/generate-page-programs.mjs` and injected as `SELECT_PAGE_SOURCE`
 * from `page-programs.gen.ts`; this file stays the one readable
 * implementation that generator reads, and `check-page-programs.test.mjs`
 * fails when the two disagree. Same transport as the structured reads
 * (`geometry-sources.gen.ts`), one implementation.
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
	// Single controls must keep exactly one choice: clearing can look like a
	// successful value change to a framework while submitting no option at all.
	if (!multiple && requested.length !== 1)
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
			// Index setter preserves duplicate-valued options without clearing a single.
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
	// aria-activedescendant is keyboard focus, NOT a committed choice. Menus
	// routinely focus Beta while Alpha remains selected until Enter/click.
	const selected = facts.filter((o) =>
		native
			? (elements[o.index] as HTMLOptionElement).selected
			: elements[o.index].getAttribute("aria-selected") === "true",
	);
	const selectedMatch =
		indexes.length === selected.length &&
		indexes.every((i) => selected.some((o) => o.index === i));
	const triggerText = (
		(this as HTMLInputElement).value ||
		this.textContent ||
		""
	).trim();
	const triggerMatch =
		!native &&
		this.getAttribute("role") !== "listbox" &&
		indexes.length === 1 &&
		triggerText === facts[indexes[0]].label;
	const verified = selectedMatch || triggerMatch;
	return {
		status: "ready",
		kind,
		multiple,
		selected: native ? selected : indexes.map((i) => facts[i]),
		verified,
		available,
	};
}
