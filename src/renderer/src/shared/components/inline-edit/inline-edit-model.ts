/**
 * The per-field inline editor's pure model: the phase vocabulary, the
 * keyboard contract, and the never-clobber re-seed rule, as functions with no
 * React and no feature in them, so `scripts/projects-inline-edit.test.mjs` can
 * pin every case in Node rather than by eye.
 *
 * WHY A SHARED MODULE, AND WHY IT LOOKS LIKE THIS. The app has exactly one
 * editing language for catalogue records, and the agents/teams lane is
 * expected to be its next consumer (`docs/design/agents-inplace-shared-composer.md`
 * § 2, PR #725): a field edits in place, blur accepts, Enter accepts (Cmd/Ctrl
 * + Enter where a bare Enter is a newline), Escape reverts the FIELD, a dirty
 * field is never silently clobbered by an out-of-band write, and the chrome is
 * a check and an x. This module is the machine half of that contract; the
 * hook (`use-inline-edit.ts`) and the chrome (`inline-edit-controls.tsx`,
 * `inline-edit-feedback.tsx`, `inline-edit-pane.tsx`) are the other three
 * quarters. Every consumer names its current phase in the same words, so the
 * chrome and the state machine cannot disagree.
 *
 * THE FOUR CASES the re-seed rule encodes, from § 2.4 of the note, in the
 * order the hook asks them (the record's fresh value has just arrived):
 *
 *   1. the field is not dirty            -> adopt silently;
 *   2. the field is dirty, the record
 *      moved, this field did not         -> commit normally (partial PATCH);
 *   3. the field is dirty, this field
 *      moved out-of-band                 -> hold the commit and show the
 *      "changed elsewhere" choice;
 *   4. a whole-record replacement        -> same rule, per field.
 *
 * The decision is a function of the values ALONE rather than of a stored
 * dirty flag: a draft equal to its base cannot lose anything by adopting, and
 * that is checked first so a save racing a re-seed cannot hold a phantom
 * conflict.
 */

/** One field's phase. `dirty` is deliberately not a phase: it is derived. */
export type InlineEditPhase = "idle" | "editing" | "saving" | "saved" | "error";

/**
 * Whether the editor control is the thing on screen. `saved` is NOT editing:
 * the write has landed and the field shows the record again, with a transient
 * acknowledgement beside it. `error` stays in the editor, holding the
 * attempted value for a retry or a revert.
 */
export function inlineEditEditorShown(phase: InlineEditPhase): boolean {
	return phase === "editing" || phase === "saving" || phase === "error";
}

/**
 * Whether a draft differs from the value it is compared against.
 *
 * `equals` is a parameter for the same reason `formatProjectDay` takes its
 * locale: a field whose draft is not a string (an estimate plus its unit) has
 * to say what identity means for it, and a caller that owns no identity gets
 * `Object.is`, which is right for every string draft.
 */
export function inlineEditDirty<T>(
	base: T,
	draft: T,
	equals: (a: T, b: T) => boolean = Object.is,
): boolean {
	return !equals(base, draft);
}

/** What a key press means to a field. `null` means "the control's own". */
export type InlineEditKeyAction = "accept" | "revert" | null;

/**
 * The keyboard contract, as a function.
 *
 * - Escape reverts the field, ALWAYS, and the caller `preventDefault`s it so
 *   nothing downstream (a turn interrupt, a dialog's close) also consumes it.
 * - Enter accepts a single-line field and is a NEWLINE in a multiline one,
 *   where Cmd/Ctrl+Enter accepts instead. A multiline field that accepted a
 *   bare Enter could never hold a second line.
 * - `keyboardCommit: false` is for controls where Enter belongs to the control
 *   (a select trigger opening its menu); their own activation is the accept.
 * - `onEditor` scopes Enter acceptance to the editing control itself: Enter on
 *   the check/x button must stay the button's own activation, or one press
 *   would fire the machine AND the button.
 */
export function inlineEditKeyAction(
	event: {
		key: string;
		metaKey?: boolean;
		ctrlKey?: boolean;
		defaultPrevented?: boolean;
	},
	options: { multiline: boolean; keyboardCommit: boolean; onEditor: boolean },
): InlineEditKeyAction {
	/*
	 * AN ESCAPE SOMETHING ELSE ALREADY CONSUMED IS NOT OURS (note § 2.2: the
	 * guard `useEscapeToCancel` carries on main - "`defaultPrevented` is
	 * checked first so an open picker closes before the field does"). A Radix
	 * `Select` dismisses at the NATIVE level: `DismissableLayer` listens on
	 * `document` in the capture phase and calls `preventDefault()` when it
	 * closes, and react-dom copies `nativeEvent.defaultPrevented` into the
	 * synthetic event - so without this check ONE press closed the menu (which
	 * stops propagation of nothing) and this handler, one level up in the
	 * bubble phase, reverted the whole field and discarded the draft. The
	 * second Escape has nothing left to consume and reverts, exactly as
	 * "Escape reverts the field" promises (Scope A contract check, G1).
	 */
	if (event.key === "Escape")
		return event.defaultPrevented === true ? null : "revert";
	if (event.key !== "Enter") return null;
	if (!options.keyboardCommit) return null;
	const chord = event.metaKey === true || event.ctrlKey === true;
	if (options.multiline) {
		/* A bare Enter is a newline; the chord accepts, and it is deliberately
		 * NOT gated on the event target (round 1, n2): the description's
		 * Write|Preview toggle is part of the field's chrome, and a reader who
		 * checked their markdown and pressed Cmd+Enter from the toggle means
		 * the same thing as one who pressed it in the textarea. A bare Enter
		 * still requires the editor, because on any OTHER control in the
		 * chrome Enter is that control's own activation (the toggle flips, the
		 * check accepts through its click). */
		return chord ? "accept" : null;
	}
	return options.onEditor ? "accept" : null;
}

/**
 * Whether the slot's check/x are on screen, per § 2.2's dirty-gate: the two
 * controls appear ONLY once the draft differs from its base, so a field that
 * is merely focused on an unchanged value shows no accept/cancel at all
 * (design round 1, D2 - the `editing` frame drew them on a clean draft and
 * made the focused and dirty states indistinguishable).
 *
 * `saving` and `error` are their own doors and keep the chrome whatever the
 * dirty reading says: the spinner reports the write in flight, and the check
 * is the error's retry (§ 2.6). Both states only exist after an accept, which
 * itself only runs on a changed draft, so in practice this clause is the
 * explicit spelling of "their doors stay" rather than a live distinction.
 */
export function inlineEditChromeShown(
	phase: InlineEditPhase,
	dirty: boolean,
): boolean {
	if (phase === "saving" || phase === "error") return true;
	return phase === "editing" && dirty;
}

/** What to do when the record's fresh value for this field arrives. */
export type InlineEditReseed = "none" | "adopt" | "conflict";

/**
 * The re-seed decision (§ 2.4), as a function of the phase and the three
 * values. `fresh` is the record's value on this render; `base` is what the
 * draft was last compared against; `draft` is what the field holds.
 *
 * A write in flight owns the field until it settles (`saving`), and `saved` is
 * the write's own acknowledgement, so both stand still; the values reconcile
 * on the next transition, when the phase is `idle` again.
 */
export function inlineEditReseed<T>(input: {
	phase: InlineEditPhase;
	base: T;
	draft: T;
	fresh: T;
	equals: (a: T, b: T) => boolean;
}): InlineEditReseed {
	const { phase, base, draft, fresh, equals } = input;
	if (phase === "saving" || phase === "saved") return "none";
	if (equals(base, fresh)) return "none";
	if (phase === "idle") return "adopt";
	/* A clean draft has nothing to lose; a draft that already IS the fresh
	 * value (someone else wrote exactly what is typed) has nothing to answer.
	 * The DRAFT is the SECOND argument in both comparisons - the order the
	 * comparator's directional rule is defined over - so an emptied draft
	 * adopts a moved record instead of holding a conflict over a request it
	 * would never send (review round 2, m-A). */
	if (equals(base, draft)) return "adopt";
	if (equals(fresh, draft)) return "adopt";
	return "conflict";
}

/** Whether an accept would send anything. Unchanged accepts just close. */
export function inlineEditAcceptSends<T>(
	base: T,
	draft: T,
	equals: (a: T, b: T) => boolean = Object.is,
): boolean {
	return !equals(base, draft);
}
