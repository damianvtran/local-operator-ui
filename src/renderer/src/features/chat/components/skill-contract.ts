/**
 * The `$skill` list's contract: key routing, row identity, footer copy, and the
 * no-rows notice.
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
	| { kind: "close" };

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
			// Floored at 0: an open list can now have zero rows (the D3 empty
			// state), where an unclamped `count - 1` would walk `active` to -1.
			const index = Math.max(Math.min(input.active + 1, input.count - 1), 0);
			return { kind: "move", index, moved: index !== input.active };
		}
		case "ArrowUp": {
			const index = Math.max(input.active - 1, 0);
			return { kind: "move", index, moved: index !== input.active };
		}
		case "Enter":
			/*
			 * No row to take: PASS, so the line is sent as written. The old
			 * answer claimed the key ("the user pressed it to take a row"), which
			 * was unreachable while an open list always held rows - but a
			 * no-match query now keeps its listbox up saying the miss (design
			 * round 1, D3), and claiming Enter there would wedge the very send
			 * the empty state explains. The sibling's rule for its empty list is
			 * the same (`slashKeyIntent`: no row, `pass`).
			 */
			return input.count > 0 && input.active < input.count
				? { kind: "apply", index: input.active }
				: { kind: "pass" };
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

/* ------------------------------------------------------------------ */
/* The no-rows notice: what the list says when it has no row to offer  */
/* ------------------------------------------------------------------ */

/*
 * WHY THE LIST ALWAYS SAYS SOMETHING (spec-reconciliation.md §2, the v2
 * sessionless contract). The operator's report was a bare `$` that opened
 * nothing — no list, no sentence, no path from "nothing happened" to "why" —
 * in three different states (a draft pane, an older build, an empty or
 * unreachable vocabulary). The fix is one predicate: a LEADING token always
 * opens SOMETHING — rows, or one non-selectable line in the same shell — and
 * silence survives only where it is the honest answer (the read is still
 * loading, no capability answer has arrived, or the token is not leading at
 * all).
 *
 * ORDER IS THE CONTRACT, durable > transient > empty > miss:
 *
 *   - DURABLE (`skill_catalogue` absent): this backend cannot answer a
 *     sessionless read at all. NO query is fired, and the sentence is the
 *     update-the-backend register, the same one the `@` composer notice uses
 *     (`at-contract.ts`, `AT_UNAVAILABLE_REASON`): the state, then the one
 *     remedy that can change it.
 *   - TRANSIENT (unpaired ∪ the fired query's own error): reachability is not
 *     a pane property — one string serves drafts and sessions alike, and it
 *     never promises a session (UX v2 §1).
 *   - EMPTY (settled, zero rows): "No skills found" with the pointer clause
 *     only where the pointer can be followed — `/skills` needs a conversation
 *     (its own dispatcher gate, `slash-dispatch.ts`), so a draft gets the
 *     bare sentence. Bare `$` and a typed `$zzz` against zero vocabulary both
 *     take this notice.
 *   - MISS (settled NON-empty vocabulary, query typed, no matches):
 *     "No skills match." — unchanged from #690.
 *
 * WHERE A NOTICE MAY ATTACH, and this is the money guard rather than polish:
 * the three consultation states attach to LEADING tokens only. An inline `$`
 * mid-sentence is overwhelmingly money or a shell variable, and "the sigil's
 * position tells you nothing inline" is the rule that makes running the
 * tokenizer on every keystroke of prose safe (`skill-token.ts`). The MISS is
 * unchanged and attaches wherever it always did: a typed query over a settled
 * non-empty vocabulary is positive evidence the user meant a skill, leading or
 * not.
 *
 * WHAT `available` DOES OVER THE ERROR STATE: rows were served, so a background
 * refetch's failure does not replace them with "aren't available" — the stale
 * vocabulary is usable and React Query retries on its own. A fresh read's
 * failure has no rows and takes the transient line; so does `unpaired`, whose
 * cached rows are not trustworthy at all.
 */

/** The four states a no-rows list can be in, in precedence order. */
export type SkillNoticeKind = "durable" | "transient" | "empty" | "miss";

/** The notice line and the state it names. `text` is what the list renders. */
export type SkillNotice = { kind: SkillNoticeKind; text: string };

/**
 * The durable state's sentence, in the app's update-the-backend register.
 *
 * Worded after `AT_UNAVAILABLE_REASON` (`at-contract.ts`), the sibling notice
 * in the same composer slot, because the two states are the same kind of fact
 * one capability over: this backend cannot serve the thing the gesture needs,
 * and updating it is the way out. The design round ratifies the exact string;
 * the register it must stay in is the one both siblings write.
 */
export const SKILL_UNAVAILABLE_REASON =
	"This backend cannot serve the skill catalogue. Update the backend and try again.";

/** The transient state's sentence; one string for every pane and cause. */
export const SKILL_TRANSIENT_REASON = "Skills aren't available right now.";

/** The empty state where `/skills` can be followed (a session is attached). */
export const SKILL_EMPTY_ATTACHED = "No skills found — see /skills";

/** The empty state on a draft, where `/skills` would be refused. */
export const SKILL_EMPTY_DRAFT = "No skills found.";

/** The miss line, unchanged from #690. */
export const SKILL_MISS_LINE = "No skills match.";

export type SkillNoticeInput = {
	/**
	 * `desktopFeatureState(capabilities, "skill_catalogue")`'s answer — the
	 * literal union is repeated rather than imported so this module stays free
	 * of the hooks tree at runtime; the caller passes the value through, so a
	 * new state name is a compile error at the call site, not a silent fall.
	 */
	feature: "enabled" | "unpaired" | "below-version" | "unknown";
	/** Whether the pane has a folder to discover from (mid-edit is empty). */
	hasCwd: boolean;
	/** Whether the pane can address a session — the `/skills` pointer's gate. */
	attached: boolean;
	/** Whether the token leads the draft (the money-guard rule above). */
	leading: boolean;
	/** Whether the token carries typed text. */
	hasQuery: boolean;
	/** Rows the current filter leaves. */
	rowsCount: number;
	/** Whether the settled vocabulary is non-empty (empty vs miss). */
	vocabularyNonEmpty: boolean;
	/** The query's own state, as one of three answers. */
	query: "pending" | "error" | "success";
};

/**
 * The notice to render for this state, or `null` for "nothing to say" — the
 * available state, a quiet one, or a token the notice may not attach to.
 */
export function skillNotice({
	feature,
	hasCwd,
	attached,
	leading,
	hasQuery,
	rowsCount,
	vocabularyNonEmpty,
	query,
}: SkillNoticeInput): SkillNotice | null {
	// DURABLE first: a capability fact outranks everything, and no query was
	// fired on this build to ask anything else.
	if (feature === "below-version")
		return leading ? { kind: "durable", text: SKILL_UNAVAILABLE_REASON } : null;
	// TRANSIENT, pairing half: a daemon this app holds no credential for is a
	// pairing fact no matter what its feature list says (`desktopFeatureState`).
	if (feature === "unpaired")
		return leading ? { kind: "transient", text: SKILL_TRANSIENT_REASON } : null;
	// No capability answer yet: assert neither cause.
	if (feature === "unknown") return null;
	// A folder mid-edit (or none staged): no query is fired, and silence is the
	// honest answer — there is nothing to have failed yet.
	if (!hasCwd) return null;
	// Rows were served: they answer for themselves even across a background
	// refetch failure (see the block note above).
	if (rowsCount > 0) return null;
	// TRANSIENT, transport half: the fired query failed.
	if (query === "error")
		return leading ? { kind: "transient", text: SKILL_TRANSIENT_REASON } : null;
	// Loading: quiet — no notice, and (beside it) no ink, so a read in flight
	// cannot flash a claim it may have to withdraw.
	if (query !== "success") return null;
	// EMPTY: a settled vocabulary with nothing in it. Both the bare `$` and a
	// typed `$zzz` take this notice, and only a leading token may carry it.
	if (leading && !vocabularyNonEmpty)
		return {
			kind: "empty",
			text: attached ? SKILL_EMPTY_ATTACHED : SKILL_EMPTY_DRAFT,
		};
	// MISS: a settled non-empty vocabulary and a typed query that found nothing.
	if (vocabularyNonEmpty && hasQuery)
		return { kind: "miss", text: SKILL_MISS_LINE };
	return null;
}
