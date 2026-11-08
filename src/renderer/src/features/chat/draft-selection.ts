/**
 * The readings a NEW conversation WILL be born on: one selection, one call.
 *
 * A draft pane has no session, so nothing on the canonical stream answers what
 * the first turn will run. `sessions.preview` does, by running the backend's own
 * cold resolution without creating anything — and when the user picks a model or
 * an effort rung on the pane, the pane's reading must come from THAT resolution,
 * never from the picker's row. This module is the single place that asks for it,
 * so the pane's chips, the pickers they open and the create on send cannot come
 * to three different answers about the same conversation.
 *
 * ## Why the model rides the preview at all
 *
 * Requirement of the wire contract: an OMITTED `model` is the configured default,
 * byte for byte what this op sent before the pane's chips could open. A pick is
 * additive, and the body is derived from the selection rather than from a second
 * parameter, so "what is on screen" and "what was asked for" are the same value.
 *
 * ## Why the query key carries the selection
 *
 * React Query keys by what the answer depends on. The window, the price pair,
 * the ladder and the name all change with the model, so a key that ignored it
 * would serve the previous model's reading for the new one — the exact defect
 * the draft's chips exist to make impossible. One key builder for the pane and
 * the pickers means one cache entry either can read.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { keepPreviousData } from "@tanstack/react-query";
import type { DesktopModelSelection } from "../../../../shared/desktop-contract";
import type {
	CanonicalFrontendSync,
	CanonicalModel,
} from "../../../../shared/desktop-session-contract";

/** What a draft pane is asking about: where it runs, as whom, and on what. */
export type DraftSelectionTarget = {
	cwd: string;
	target?: ChatTarget;
	/** The pick, or `null`/absent for "nothing chosen — the configured default". */
	model?: DesktopModelSelection | null;
};

/**
 * The readings a DRAFT pane can open a picker for.
 *
 * Three, and not the context reading: nothing has been measured before the first
 * turn, so there is no breakdown to show and no control to offer (R19/R21 of the
 * design). Named by destination rather than by command, because a chip has no
 * command line: the names are the ones `DESTINATIONS` already routes on, so one
 * table still answers "which adapter presents this".
 *
 * `/fast` is the one member with no chip to open it (issue #1265): the typed
 * command is its only door, which is why its row also carries the dispatcher's
 * `draftSelection` route. The type is the same either way, because the picker
 * and the pane's selection do not care which door mounted the dialog.
 */
export type DraftPickerDestination =
	| "session.model"
	| "session.effort"
	/*
	 * `/fast` (issue #1265): the same two-mode shape as the other two, because the
	 * dial is a property of the model the conversation will be born on and a new
	 * chat has no session to command. Its pick is a third reading of the one
	 * `DraftPickerSession` - see `FastPicker`'s draft branch.
	 */
	| "session.fast";

/**
 * The one identity string for a selection, in the spelling the picker's rows and
 * the model readings already compare (`provider/model_id`). `null` when either
 * half is empty, for the reason `modelSelector` gives: two empty halves must name
 * nothing rather than interpolate `/`.
 */
export function selectionSelector(
	selection: DesktopModelSelection | null | undefined,
): string | null {
	if (!selection?.provider || !selection.model_id) return null;
	return `${selection.provider}/${selection.model_id}`;
}

/**
 * The selection that names this spec, or `null` when the spec does not name a
 * model. Used to seed the draft's row from a resolution the backend already
 * made, so a pick that is confirmed by the preview is the same value the pane
 * and the create read — not a separately assembled object.
 */
export function selectionFromModel(
	model: CanonicalModel | null | undefined,
): DesktopModelSelection | null {
	if (!model?.provider || !model.model_id) return null;
	const effort =
		typeof model.reasoning_effort === "string"
			? model.reasoning_effort.trim()
			: "";
	return {
		provider: model.provider,
		model_id: model.model_id,
		// Absent or blank is "no rung chosen", which is `null` on this wire. The
		// word `auto` belongs to the picker's vocabulary, not to a request.
		reasoning_effort: effort === "" ? null : effort,
	};
}

/**
 * A target that asks nothing.
 *
 * The pickers are two-mode components — a session's and a draft pane's — and a
 * hook cannot be called conditionally, so the draft branch's query is mounted in
 * both modes and disabled outside a draft. This is what it is mounted with then:
 * the query never runs, so the empty cwd never reaches the wire, and a reader
 * sees the intent rather than a stray default.
 */
export const NO_DRAFT_TARGET: DraftSelectionTarget = { cwd: "" };

/** The query key, which is what the answer depends on. */
export function draftPreviewKey(target: DraftSelectionTarget) {
	return [
		"desktop",
		"session-preview",
		target.cwd,
		target.target?.kind ?? null,
		target.target?.name ?? null,
		selectionSelector(target.model),
		target.model?.reasoning_effort ?? null,
		/*
		 * The dial too, and for the reason the model and the rung are here: the
		 * preview's answer depends on it. Without this key a fast pick re-read the
		 * SAME cache entry the pane had before the pick - the entry whose snapshot
		 * says the dial is off - so a confirmed pick would resolve to the reading it
		 * just replaced: the picker's mark would stay on the old state and the pick
		 * would look like it did nothing.
		 */
		target.model?.fast_mode ?? null,
	] as const;
}

/**
 * Ask the backend what the first turn would get, for THIS selection.
 *
 * The request id is minted per call: a preview has no side effect to make
 * at-most-once (the backend does not journal it), and a retry is a new question
 * about the same selection rather than a replay.
 */
export async function fetchDraftPreview(
	target: DraftSelectionTarget,
): Promise<CanonicalFrontendSync> {
	const result = await desktopResult<{ frontend: CanonicalFrontendSync }>({
		op: "sessions.preview",
		requestId: crypto.randomUUID(),
		cwd: target.cwd,
		...(target.target ? { target: target.target } : {}),
		...(target.model ? { model: target.model } : {}),
	});
	return result.frontend;
}

/**
 * What a MODEL pick does to the effort level the user had already chosen.
 *
 * The wire cannot express "keep the previous rung": `reasoning_effort` names a
 * level on THIS request, and `null` is "no rung chosen", which the backend
 * resolves to the new model's own default. A pick that always sent `null`
 * therefore discarded an explicit choice in silence - the pane read `low` where
 * the user had set `high`, the first turn ran at a different level AND a
 * different cost, and every on-screen signal said the pick had succeeded
 * (UX U1; design D7 is the same defect read from the copy side).
 *
 * The backend can answer the only question that matters - does the new model
 * OFFER that level - so this decides AFTER the new model is resolved, from the
 * resolution's own ladder, and returns both halves of the answer: the rung to
 * record, and the sentence the confirmation must print. Clearing a rung is a
 * legitimate outcome; clearing it silently is not, which is why the two live
 * together here rather than at the call site, where the sentence could drift
 * from the decision it describes.
 *
 * ## `checked`, and why an unreadable ladder is not an empty one
 *
 * An unresolved read reports no ladder at all, which is a different fact from a
 * model that reports an empty one (UX round 3's U12, the predicate
 * `specUnresolved` exists for). `ladder.includes(...)` is false in both cases,
 * so the third branch used to assert "belongs to the other model's ladder"
 * about a model whose ladder nobody had read (review round 4, F4). `checked` is
 * how the caller can tell the difference and refuse rather than guess.
 *
 * ## Normalising here (review round 4, Q-R4-2)
 *
 * `carried` arrives as the pane holds it, padded and in whatever case the rung
 * was written in; matching it against the ladder is the helper's job, not the
 * caller's, so the trim lives here and the comparison is case-insensitive. The
 * spelling RECORDED is the ladder's own, never the caller's, because that is
 * the string the wire will be asked about again.
 *
 * `level` is the level the new model runs without a rung, read off the same
 * resolution - and `null` when the resolution names none, which is the case a
 * non-reasoning target produces. No sentence here says "its own default": that
 * phrase was reported as a claim the pane cannot support on such a target
 * (review round 4, Q-R4-1), and naming no level is what "no level is set" is
 * for.
 */
export type EffortTarget = {
	/** The rungs the new model reported, in its own order. */
	ladder: readonly string[];
	/**
	 * Whether the resolution REPORTED a ladder, as opposed to none at all.
	 * `reasoning_efforts` is present-but-empty on a model that has no levels.
	 */
	ladderKnown: boolean;
	/** The level the new model runs with no rung chosen, or `null` if unwritten. */
	level: string | null;
};

export type EffortCarry =
	| {
			/** The ladder was read and the decision stands. */
			checked: true;
			/** The rung to record, in the ladder's own spelling, or `null`. */
			rung: string | null;
			/** What the confirmation says, given the selector that was resolved. */
			confirmation: (selector: string) => string;
	  }
	| {
			/**
			 * The new model's levels could not be READ. The caller must then refuse
			 * the pick rather than record a rung-less selection while a level the
			 * user chose disappears without a word (review round 4, F1).
			 */
			checked: false;
			rung: null;
			/**
			 * What the refusal says, in full: what happened, what it means, what to
			 * do (branding § 8), and it is written HERE so it cannot drift from the
			 * decision it describes.
			 *
			 * It used to be a confirmation carrying the resolved selector - a
			 * sentence claiming "this conversation will run X" on a path where the
			 * pick is refused and nothing runs on X, which is why nothing could ever
			 * print it (review round 5, D19). A refusal is not a confirmation, and
			 * the real resolution is not known until after the check passes, so the
			 * honest sentence here names no model at all.
			 */
			refusal: string;
	  };

export function effortCarry(
	carried: string,
	target: EffortTarget,
): EffortCarry {
	const wanted = carried.trim();
	if (!wanted)
		return {
			checked: true,
			rung: null,
			confirmation: (selector) => `This conversation will run ${selector}.`,
		};
	if (!target.ladderKnown)
		return {
			checked: false,
			rung: null,
			/*
			 * The act is cheap and available - the list is still on screen and the
			 * failure is a resolution that did not answer - so the sentence names
			 * it. It also stops repeating "changed", which the previous wording
			 * did twice in one breath (review round 5, D19).
			 */
			refusal:
				"Nothing was changed, because that model's effort levels could not be read. Try again.",
		};
	const offered = target.ladder.find(
		(rung) => rung.trim().toLowerCase() === wanted.toLowerCase(),
	);
	if (offered)
		return {
			checked: true,
			rung: offered,
			confirmation: (selector) =>
				`This conversation will run ${selector} at ${offered} effort.`,
		};
	return {
		checked: true,
		rung: null,
		confirmation: (selector) =>
			target.level
				? `This conversation will run ${selector}. Its effort is now ${target.level}, because ${wanted} is not one of that model's levels.`
				: `This conversation will run ${selector}. No effort level is set on it, because ${wanted} is not one of that model's levels.`,
	};
}

/**
 * What a MODEL pick on a draft says about a fast dial the user had already set.
 *
 * The model pick builds a FRESH selection (`{provider, model_id,
 * reasoning_effort: null}`), because a new model has its own ladder and its own
 * tier; the fast dial is not part of the new model's identity, so it does not
 * ride the pick. That is the same act the effort carry refuses to do in
 * silence (UX U1, design D7), and it is what design review round 1's D1 and
 * agent review round 1's F2 both filed: set `/fast` On, pick another model from
 * the chip one click away, and the pane is born standard with nothing said.
 *
 * CARRYING THE DIAL IS NOT THE ANSWER, and the review says why: `fast_mode:
 * true` on a model without the tier is a 422 that refuses the WHOLE pick (the
 * core raises `fast_mode_unsupported`), so a carry would turn "change model"
 * into "you cannot change model". So the pick states what happened instead,
 * read off the RESOLUTION rather than the request - the sentence names the dial
 * the first turn will actually get.
 *
 * The clause is only printed when the pane HAD the dial on: a pane that never
 * picked one has nothing to report, and an explicit `Off` is not a loss.
 *
 * THE OFF SENTENCE NAMES THE CAUSE (round 2's follow-up nit): "fast mode is off"
 * is the outcome, and the reader's question is why a pick they did not make toggled
 * it. This function only ever runs for a MODEL PICK, so the cause is always the
 * change of model.
 */
export function fastModelPickNotice(
	carried: boolean | null | undefined,
	dial: "on" | "off" | null,
): string | null {
	if (carried !== true) return null;
	if (dial === "on") return "Fast mode stays on for this model.";
	if (dial === "off") return "Changing the model turned fast mode off.";
	return "This model does not support fast mode, so it stays off.";
}

/**
 * What a pane says when a dial the user SET cannot ride this backend's wire.
 *
 * The cause is the SERVICE, not the model, which is why the model-pick sentence
 * above would be a lie here: the model has the tier, and the daemon refuses the
 * field. Round 2's F1 follow-up is the case - a draft row persisted with
 * `fast_mode: true` meets a core that predates `DraftModel.fast_mode` - and the
 * answer is not to send it and let the whole body 422 (see
 * `draftModelForWire`), nor to drop it in silence, which is the discard the
 * effort carry exists to prevent.
 */
export const FAST_UNAVAILABLE_SENTENCE =
	"Fast mode is off: this version of the Local Operator service cannot carry it.";

/**
 * The notice's own code, so the statement survives the machinery that retires the
 * lock answer (QA round 2, Q1).
 *
 * The sentence above goes into the composer's `muted` register, the same one the
 * lock answer uses, and the retirement effect keyed on `muted` alone - so on a
 * restored draft, where nothing is pending, admitting or gated, the line was
 * cleared in the commit after it was set and never reached the screen.
 * `lockAnswerOutlived` retires only the lock answer now, which is the one muted
 * notice that names no code; this states which condition this one is rather than
 * borrowing the lock's silence.
 */
export const FAST_UNAVAILABLE_CODE = "fast_unavailable";

/**
 * The selection a draft may SEND, given whether this backend carries the dial.
 *
 * `DraftModel` is `extra="forbid"` on the core, so a persisted `fast_mode` meets
 * a backend that cannot parse it with a 422 for the WHOLE body - and the same
 * field rides `sessions.preview` (draft-selection.ts's own sender),
 * `sessions.draft` (the warm mint) and `sessions.create`. Dropping it at the
 * senders is the guard; the ROW is left alone, because the dial was the user's
 * choice and a capable backend restores it, and the pane says so in the same
 * breath (`FAST_UNAVAILABLE_SENTENCE`, surfaced by the chat page).
 *
 * A selection with no `fast_mode` is returned by IDENTITY: the ordinary body
 * must stay byte-for-byte what every caller sent before the field existed.
 */
export function draftModelForWire(
	model: DesktopModelSelection | null | undefined,
	carriesFast: boolean,
): DesktopModelSelection | null {
	if (!model) return null;
	if (carriesFast || model.fast_mode === undefined) return model;
	const { fast_mode: _dropped, ...rest } = model;
	return rest;
}

/**
 * The sentence a SUCCESSFUL pick's result strip prints, for either shape of pick.
 *
 * ONE PLACE FOR THE COMPOSITION, because the two branches used to choose between
 * `carry.confirmation` and `describe` at the call site - and the model pick's
 * dial notice lived inside `describe`, so it ran only when no effort rung was
 * carried (design review round 2, D6: effort -> high, `/fast` -> On, model chip
 * -> pick B, and the dial went off with nothing said). The notice is composed
 * AFTER the branch, so it cannot be skipped by the branch that wins.
 */
export function pickResultText(input: {
	/** The effort carry decision, when this pick changes a model and had a rung. */
	carried: EffortCarry | null;
	/** The selector the resolved answer names, for `carried.confirmation`. */
	selector: string;
	/** The pick's own sentence, used when no carry decision produced one. */
	described: string;
	/** The notice that is true regardless of which branch spoke, or `null`. */
	notice: string | null;
}): string {
	const base =
		input.carried?.checked === true
			? input.carried.confirmation(input.selector)
			: input.described;
	return input.notice ? `${base} ${input.notice}` : base;
}

/**
 * What a fast pick says when the REQUEST itself failed.
 *
 * The catch used to print `The fast dial could not be set. <error.message>`,
 * which put the daemon's own text on screen - and on the one deployment the
 * route meets in the field it put `The request has invalid fields.` there: a
 * core older than `DraftModel.fast_mode` (local-operator#2848) refuses the whole
 * body, because that model is `extra="forbid"` (design review round 1, D4).
 *
 * Three outcomes, distinguished by what the backend said rather than by the
 * status alone:
 *  - `fast_mode_unsupported` is the core's own code for a model without the
 *    tier, and the reader's next act is to pick another model, not to update
 *    anything;
 *  - a 422 WITHOUT a code is the older core that has never heard of the field,
 *    and that is the update sentence;
 *  - anything else (a dropped connection, a timeout) names the failure and the
 *    one thing to try.
 */
export function fastPickFailure(error: unknown): string {
	const refusal = error instanceof DesktopControlError ? error : null;
	if (refusal?.code === "fast_mode_unsupported")
		return "This model cannot run fast mode. Pick a model that can.";
	if (refusal?.status === 422)
		return "Fast mode is not available on this version of the Local Operator service. Update Local Operator, then try again.";
	return "Fast mode was not changed. Try again.";
}

/**
 * Where the pane's resolution IS, for the states in which it has no reading yet.
 *
 * A draft's model and effort readings are the backend's own answer for its
 * selection, so there is a window — and a failure - in which the pane has no
 * reading rather than an unresolved one, and the two must not be spelled the
 * same way (UX U3). The strip's "no model resolved yet" entry claims a
 * RESOLUTION that named nothing; while the resolution is in flight, or after it
 * failed, the honest statement is about the question rather than its answer.
 * `pending` therefore gets the app's own not-yet-known treatment (the dim ink
 * and spinner the session's switching chip uses) and `failed` gets a control
 * that retries, because `retry: false` on the query means nothing else will.
 *
 * Built by the pane from its own query, and consumed only by the strip, so the
 * two cannot disagree about which of the three states the pane is in.
 */
export type DraftResolution =
	| { status: "pending" }
	| { status: "failed"; retry: () => void };

/**
 * The query the pane and the pickers share.
 *
 * `keepPreviousData` is load-bearing rather than a nicety: picking a model
 * changes the key, and without it the strip would be handed no snapshot at all
 * for the length of the fetch — the cluster would unmount and the composer's row
 * would reflow under the user's click, which is the shift R23 forbids. With it
 * the previous reading stands until the chosen model's own reading arrives.
 *
 * `staleTime` says the resolution is config state: it changes when the selection
 * changes, not between two paints of one pane.
 *
 * THE WIRE MODEL IS FILTERED HERE, at the sender, because the preview is the
 * first request a persisted `fast_mode` rides (round 2's F1 follow-up): a
 * backend without `draft_fast` refuses the field for the WHOLE body, so the pane
 * would fail to resolve anything at all - and the pickers' own previews would
 * fail with it. The KEY is built from the filtered selection too, so a pane whose
 * dial cannot ride has the same cache entry as the same selection without one:
 * two entries would be two answers to one question.
 */
export function draftPreviewQuery(
	target: DraftSelectionTarget,
	carriesFast: boolean,
) {
	const wire: DraftSelectionTarget = {
		...target,
		model: draftModelForWire(target.model, carriesFast),
	};
	return {
		queryKey: draftPreviewKey(wire),
		queryFn: () => fetchDraftPreview(wire),
		placeholderData: keepPreviousData,
		staleTime: 30_000,
		retry: false,
	} as const;
}
