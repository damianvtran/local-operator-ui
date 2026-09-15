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

import { desktopResult } from "@shared/api/local-operator/desktop-api";
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
 * Two, and not the context reading: nothing has been measured before the first
 * turn, so there is no breakdown to show and no control to offer (R19/R21 of the
 * design). Named by destination rather than by command, because a chip has no
 * command line: the names are the ones `DESTINATIONS` already routes on, so one
 * table still answers "which adapter presents this".
 */
export type DraftPickerDestination = "session.model" | "session.effort";

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
 */
export function draftPreviewQuery(target: DraftSelectionTarget) {
	return {
		queryKey: draftPreviewKey(target),
		queryFn: () => fetchDraftPreview(target),
		placeholderData: keepPreviousData,
		staleTime: 30_000,
		retry: false,
	} as const;
}
