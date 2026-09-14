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
