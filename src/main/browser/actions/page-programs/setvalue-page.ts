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
 * WHAT IT REFUSES, and why each refusal is here rather than in the host: every
 * one of them is a case where a write would "succeed" without meaning anything.
 * A checkbox/radio has no value to write — its state is `checked`, and `value`
 * is only what it would submit — so toggling belongs to `click`. A password
 * field's value is a credential and this answer travels into a transcript, so
 * it is read back internally and never returned. A value-sanitizing input
 * (date, time, number, colour, …) refuses a string it does not store as asked,
 * and a refusal RESTORES the value the control already held (the setter is the
 * only way to learn what a sanitizer would do, so the write happens first and is
 * undone), leaving the page exactly as it was and having dispatched nothing.
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
	/** One real user edit: `input` then `change`, both BUBBLING and COMPOSED. A
	 * real edit is composed, so it crosses a shadow boundary and a custom
	 * element whose state lives on the host still learns about the write; a
	 * bubbling-only event stops at the shadow root, which is the same "looks
	 * filled, the app never moved" failure on a narrower surface. `select` uses
	 * the identical pair for the identical reason. */
	const dispatch = (target: Element) => {
		target.dispatchEvent(
			new win.Event("input", { bubbles: true, composed: true }),
		);
		target.dispatchEvent(
			new win.Event("change", { bubbles: true, composed: true }),
		);
	};
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
		isInput &&
		["checkbox", "radio"].includes((this as HTMLInputElement).type)
	) {
		// A checkbox/radio has NO value to write: `value` is what the control
		// would SUBMIT, and its state is `checked`. Writing the value and reading
		// it back would answer verified:true while the box stayed unticked — the
		// exact "looks filled, the app never moved" failure this verb exists to
		// remove. Toggling is `click`, which fires real activation behaviour and
		// the page's own handler with it.
		return {
			status: "not_a_value_control",
			tag: tag.toLowerCase(),
			input_type: (this as HTMLInputElement).type,
		};
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
		// THE SAME LADDER `select` USES (select-page.ts), so the two verbs cannot
		// disagree about which option a name means: exact label, case-insensitive
		// label, exact value. There is deliberately NO case-insensitive VALUE tier
		// — `select` has none, and a ladder that differs by one tier is exactly
		// how the pair silently lands on different options.
		const tiers = [
			(fact: { label: string; value: string }) => fact.label === needle,
			(fact: { label: string; value: string }) =>
				fact.label.toLowerCase() === needle.toLowerCase(),
			(fact: { label: string; value: string }) => fact.value === needle,
		];
		let matches: Array<{ index: number; label: string; value: string }> = [];
		for (const tier of tiers) {
			matches = facts.filter(tier);
			if (matches.length) break;
		}
		if (!matches.length) return { status: "option_not_found", available };
		// A single select can only hold one option, so a repeated label is
		// harmless there (the first match is the one the value setter would
		// pick anyway). On a MULTIPLE select the same request is ambiguous: two
		// options both named "Beta" and no way to say which. Refuse rather than
		// pick one on the caller's behalf.
		if (select.multiple && matches.length !== 1) {
			return { status: "option_ambiguous", available, matches: matches.length };
		}
		const chosen = matches[0];
		const matched = {
			index: chosen.index,
			label: clip(chosen.label),
			value: clip(chosen.value),
		};
		// PARITY WITH `select`: a disabled option — or one inside a disabled
		// optgroup, or an inert subtree — is refused BEFORE any mutation, with the
		// same `disabled` reason token. A state a person cannot produce must not be
		// reported as success, and the sibling verb already refuses it.
		if (
			options[chosen.index].matches(":disabled, [aria-disabled=true]") ||
			options[chosen.index].closest("optgroup[disabled], [inert]")
		) {
			return { status: "disabled", kind: "select", available, matched };
		}
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
		dispatch(select);
		const readBack = select.value;
		return {
			status: "ready",
			kind: "select",
			value: readBack,
			verified: readBack === chosen.value,
			matched,
			available,
		};
	}

	const proto = isTextarea
		? win.HTMLTextAreaElement.prototype
		: win.HTMLInputElement.prototype;
	const setValue = (input: string) =>
		(
			Object.getOwnPropertyDescriptor(proto, "value") as {
				set: (input: unknown) => void;
			}
		).set.call(this, input);
	const inputType = isInput ? (this as HTMLInputElement).type : "";
	// A value-sanitizing input does not store what it was given: it either DROPS
	// the value (date/time/month/week/number keep "") or COERCES it (range clamps
	// to min/max; a colour is parsed, so a CSS name lands as its hex and anything
	// unparsable becomes #000000). Both are a write that did not happen, and
	// reporting either as success is how a form is submitted with an empty or
	// wrong field. Each entry names the format that type accepts, because "it
	// silently kept something else" is not an instruction.
	const sanitized: Record<string, string> = {
		date: "YYYY-MM-DD",
		time: "HH:MM or HH:MM:SS",
		"datetime-local": "YYYY-MM-DDTHH:MM",
		month: "YYYY-MM",
		week: "YYYY-Www",
		number: "a number",
		range: "a number between the control's min and max",
		color: "#rrggbb",
	};
	const expected = sanitized[inputType];
	// THE ORDER HERE IS THE CONTRACT: judge the write BEFORE announcing it. A
	// sanitizer runs INSIDE the value setter, so the only way to learn what a
	// control makes of a string is to write it — which means a rejection has
	// already touched the node. Dispatching first would run the page's own
	// `input`/`change` handlers on a value this program is about to refuse, and
	// the refusal would then describe a form that has already moved: an agent
	// told "this field did not take the value" must find it exactly as it was.
	// So the prior value is snapshotted, the write is sampled, and ANY refusal
	// restores that snapshot through the same prototype setter WITHOUT
	// dispatching — unconditionally, rather than assuming which types mutate.
	const priorValue = (this as HTMLInputElement).value;
	setValue(value);
	const sampled = (this as HTMLInputElement).value;
	// A colour's read-back is FOLDED: Chromium stores `#abcdef` for `#ABCDEF`, so a
	// case-sensitive compare refused a write that had landed exactly as asked.
	// The same rule decides `verified`, or the caller would be told a correct hex
	// did not stick.
	const sameValue = (stored: string) =>
		inputType === "color"
			? stored.toLowerCase() === value.toLowerCase()
			: stored === value;
	if (value !== "" && expected && !sameValue(sampled)) {
		setValue(priorValue);
		return {
			status: "value_rejected",
			tag: tag.toLowerCase(),
			input_type: inputType,
			expected,
		};
	}
	dispatch(this);
	const readBack = (this as HTMLInputElement).value;
	// A password field's value is a CREDENTIAL and this answer travels into a
	// transcript. Read it back for honesty, then report only whether the write
	// stuck — never the value itself. The host omits `value` when `redacted`.
	if (inputType === "password") {
		return {
			status: "ready",
			kind: "input",
			type: "password",
			redacted: true,
			verified: sameValue(readBack),
		};
	}
	return {
		status: "ready",
		kind: isTextarea ? "textarea" : "input",
		type: inputType,
		value: readBack,
		verified: sameValue(readBack),
	};
}
