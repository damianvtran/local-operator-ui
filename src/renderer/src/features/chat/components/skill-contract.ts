/**
 * The `$skill` list's contract: key routing, row identity, and the footer copy.
 *
 * Pure, and its own module for the reason `slash-contract.ts` and
 * `at-contract.ts` are: the composer's keyboard routing has to be exercised as
 * the code that ships — the browser harness cannot dispatch real key events —
 * and a component file cannot be bundled by the node harness.
 */

export type SkillKeyIntent =
	/** The key is not this list's; the composer's own handling continues. */
	| { kind: "pass" }
	| { kind: "move"; index: number; moved: boolean }
	| { kind: "apply"; index: number }
	| { kind: "close" }
	/** Enter with the list up but no row to take: claim the key, write nothing. */
	| { kind: "hold" };

export type SkillKeyInput = {
	key: string;
	composing: boolean;
	open: boolean;
	active: number;
	count: number;
};

/**
 * What a key means to the open skill list. Copied from `atKeyIntent`'s shape —
 * arrows CLAMP rather than wrap, Escape is the one dismissive key — with the
 * one difference the harness's own picker states: for a skill row, Enter and
 * Tab are the SAME gesture. Accepting a row completes `$name ` into the draft
 * and STAGES it; nothing is ever run or sent by the completion, because a
 * completed `$skill ` is the opening of a prompt the user is still writing
 * (`editor.py:_complete_skill`).
 */
export function skillKeyIntent(input: SkillKeyInput): SkillKeyIntent {
	if (!input.open) return { kind: "pass" };
	if (input.composing) return { kind: "pass" };
	switch (input.key) {
		case "ArrowDown": {
			const index = Math.min(input.active + 1, input.count - 1);
			return { kind: "move", index, moved: index !== input.active };
		}
		case "ArrowUp": {
			const index = Math.max(input.active - 1, 0);
			return { kind: "move", index, moved: index !== input.active };
		}
		case "Enter":
			return input.count > 0 && input.active < input.count
				? { kind: "apply", index: input.active }
				: { kind: "hold" };
		case "Tab":
			return input.count > 0 && input.active < input.count
				? { kind: "apply", index: input.active }
				: { kind: "pass" };
		case "Escape":
			return { kind: "close" };
		default:
			return { kind: "pass" };
	}
}

/**
 * A row's DOM identity, for the listbox ids and `aria-activedescendant`.
 *
 * A skill name is `[A-Za-z0-9._-]` by discovery, so the sanitiser is the same
 * `atRowId` class of guard — belt to the vocabulary's braces, because an id
 * that is not a legal identifier is `querySelector`'s problem, not the user's.
 */
export function skillRowId(name: string): string {
	return `skill-${name.replace(/[^\w.-]/g, "_")}`;
}

/** The header strip's word for this list, beside the slash popup's labels. */
export const SKILL_PHASE_LABEL = "Skills";

/**
 * Enter's line, naming what the key does in the state the user is looking at.
 *
 * The two-clause shape is the slash popup's own for its completes-then-runs
 * cases ("Enter completes /clear; Enter again runs it."): a completion is not a
 * send, and the second key is what sends the expanded payload. `$name` echoed
 * rather than a generic word, because the line sits beside the row it names.
 */
export function skillEnterFooter(name: string): string {
	return `Enter completes $${name}; Enter again sends it.`;
}

/** The pointer's line, on the same row, for the same gesture. */
export function skillClickFooter(name: string): string {
	return `Click completes $${name}.`;
}
