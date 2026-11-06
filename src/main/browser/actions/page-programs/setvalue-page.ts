/**
 * Fixed page program for `setvalue`: one field, one value, no caller code.
 *
 * WHAT IT IS: the only way an agent writes a form control's value. `type` goes
 * through trusted native input (the keyboard), which is right for a field a
 * person would type into and wrong for a date picker's ISO value, a
 * `<select>`'s option, or a masked/date widget whose keystrokes mean something
 * else. This reaches the same DOM state a user would leave behind, and PROVES
 * it by reading the value back, so the caller never needs a screenshot to
 * confirm the write.
 *
 * WHY THE PROTOTYPE SETTER RATHER THAN `.value = x`: React (and every
 * framework shaped like it) installs an OWN `value` accessor on the node as its
 * input tracker. A write through that instance property updates the tracker, so
 * the framework's own `input` handler concludes nothing changed and drops the
 * update — the field looks filled and the app's state never moved. The
 * prototype's setter bypasses the instance property, which is what makes the
 * following `input` event look like a real edit. Same rule the select program
 * documents for `selected`/`selectedIndex`.
 *
 * WHY THE EVENTS ARE BOTH DISPATCHED: `input` is what frameworks listen to,
 * `change` is what native form code and Angular's `ngModel` listen to. A write
 * that dispatched only one of them is a write that works in half the pages.
 *
 * BOUNDARY (the reason this is a fixed program and not `eval`): the caller
 * supplies DATA only — the value string — never source. It runs in the
 * resolved element's own frame, in the session's own tab, through the same
 * surface/registry/frame plumbing `click` and `select` use. It cannot reach a
 * privileged context, cannot navigate, issues no network request and touches
 * no node outside the target.
 *
 * WHERE THE TRANSPORT COMES FROM: this module is the readable implementation;
 * `scripts/generate-page-programs.mjs` captures its source into
 * `page-programs.gen.ts`, and the host injects THAT string. It cannot travel as
 * `setvaluePage.toString()`: the packaged main bundle is V8 bytecode and its
 * loader runs the script against a dummy source string (measured — see
 * `page-programs/select-page.ts` for the incident).
 */
export function setvaluePage(this: Element, requested: string): unknown {
	const doc = this.ownerDocument;
	const win = doc.defaultView as Window & typeof globalThis;
	const clip = (text: string) => text.slice(0, 120);
	const value = typeof requested === "string" ? requested : "";
	const element = this as HTMLElement;
	const tag = element.tagName;
	const isSelect = this instanceof win.HTMLSelectElement;
	const isTextarea = this instanceof win.HTMLTextAreaElement;
	const isInput = this instanceof win.HTMLInputElement;
	// contenteditable and ARIA widgets are NOT this program's business: a
	// contenteditable has no value property to set, and an ARIA combobox owns
	// its own state through real clicks (`select`) or typing (`type`). Forging
	// `aria-*` here would be inventing page state, so the refusal is explicit.
	if (!isSelect && !isTextarea && !isInput) {
		return { status: "not_a_form_control", tag: tag.toLowerCase() };
	}
	if (isInput && (this as HTMLInputElement).type === "file") {
		// Only the browser may fill a file input, and only from a path the
		// harness chose: `upload` owns that, with its own approval.
		return { status: "file_input" };
	}
	if (
		this.matches(":disabled, [aria-disabled=true]") ||
		this.closest("[inert]")
	) {
		return { status: "disabled", tag: tag.toLowerCase() };
	}
	if ((isInput || isTextarea) && (this as HTMLInputElement).readOnly) {
		return { status: "readonly", tag: tag.toLowerCase() };
	}

	if (isSelect) {
		const select = this as HTMLSelectElement;
		const options = Array.from(select.options);
		const facts = options.map((option, index) => ({
			index,
			label: (option.label || option.textContent || "").trim(),
			value: option.value,
		}));
		const available = facts.slice(0, 50).map((fact) => ({
			...fact,
			label: clip(fact.label),
			value: clip(fact.value),
		}));
		const needle = value.trim();
		// Visible label OR value, exact before case-insensitive: what a person
		// reading the form would say, then what the form's source says. This is
		// the same order `select` matches options in, so the two verbs agree
		// about which option a name means.
		const exact = facts.filter(
			(fact) => fact.label === needle || fact.value === needle,
		);
		const loose = exact.length
			? exact
			: facts.filter(
					(fact) =>
						fact.label.toLowerCase() === needle.toLowerCase() ||
						fact.value.toLowerCase() === needle.toLowerCase(),
				);
		if (!loose.length) return { status: "option_not_found", available };
		// A single select can only hold one option, so a repeated label is
		// harmless there (the first match is the one the value setter would
		// pick anyway). On a MULTIPLE select the same request is ambiguous: two
		// options both named "Beta" and no way to say which. Refuse rather than
		// pick one on the caller's behalf.
		if (select.multiple && loose.length !== 1) {
			return { status: "option_ambiguous", available, matches: loose.length };
		}
		const chosen = loose[0];
		const selectProto = win.HTMLSelectElement.prototype;
		(
			Object.getOwnPropertyDescriptor(selectProto, "value") as {
				set: (input: unknown) => void;
			}
		).set.call(select, chosen.value);
		// The value setter selects the FIRST option carrying that value.
		// Pinning the index too is what keeps a duplicate-valued option (two
		// "Sandbox" entries, different ids) on the one that was matched.
		(
			Object.getOwnPropertyDescriptor(selectProto, "selectedIndex") as {
				set: (input: unknown) => void;
			}
		).set.call(select, chosen.index);
		select.dispatchEvent(new win.Event("input", { bubbles: true }));
		select.dispatchEvent(new win.Event("change", { bubbles: true }));
		const readBack = select.value;
		return {
			status: "ready",
			kind: "select",
			value: readBack,
			verified: readBack === chosen.value,
			matched: {
				index: chosen.index,
				label: clip(chosen.label),
				value: clip(chosen.value),
			},
			available,
		};
	}

	const proto = isTextarea
		? win.HTMLTextAreaElement.prototype
		: win.HTMLInputElement.prototype;
	(
		Object.getOwnPropertyDescriptor(proto, "value") as {
			set: (input: unknown) => void;
		}
	).set.call(this, value);
	this.dispatchEvent(new win.Event("input", { bubbles: true }));
	this.dispatchEvent(new win.Event("change", { bubbles: true }));
	const readBack = (this as HTMLInputElement).value;
	// `type` travels back because a date-like field REFUSES a value it cannot
	// parse by silently keeping "": the read-back is then the only evidence the
	// caller gets, and `verified: false` says the write did not stick.
	return {
		status: "ready",
		kind: isTextarea ? "textarea" : "input",
		type: isInput ? (this as HTMLInputElement).type : "",
		value: readBack,
		verified: readBack === value,
	};
}
