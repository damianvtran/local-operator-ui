/**
 * What the strip calls the model, and what it calls the effort level.
 *
 * Ported from the TUI band's two answers to the same questions:
 *
 *   - the model's name: `LocalOperatorApp._apply_frontend_state`
 *     (`local_operator/tui/app.py:7969-7975`), which passes the EFFECTIVE
 *     spec's `display_name` as `model_name` and
 *     `FrontendSessionState.effective_model_label`
 *     (`local_operator/session/frontend_state.py:1677`) as `model_label`
 *   - the effort level: `_effort_label` (`local_operator/tui/app.py:36508`)
 *
 * ## Why the EFFECTIVE spec and not the selected one
 *
 * `_effort_label`'s own docstring: a fallback target may clamp the chosen
 * level to its own ladder, so the segment's one job is to name the level in
 * force on the model that is actually answering. The same argument applies to
 * the name — a session that has failed over to another provider must say which
 * provider is answering, not which one was picked.
 *
 * The two existing pickers read `selected_model`, and that is correct for
 * them: `/model` and `/effort` CHANGE the selection, so they must show what
 * they are about to change. Reading a different field here is deliberate, not
 * an inconsistency.
 *
 * ## What would make this mirror wrong
 *
 * `_effort_label`'s three-state rule changing. Today: an explicit level wins;
 * a ladder with no level set reads `auto`, which is the word `/effort auto`
 * uses, so the strip and the command share one vocabulary; a model that
 * reasons with no ladder at all reads `reasoning`, which is all that can
 * honestly be said about it; and a non-reasoning model renders nothing, which
 * is what makes the segment's presence informative.
 */

import type { CanonicalModel } from "../../../../../shared/desktop-session-contract";

export type ModelIdentity = {
	/** What the chip prints: the human name if resolution found one, else the id. */
	name: string;
	/** `provider/model_id` — what the tooltip prints, and what `/model` matches on. */
	selector: string;
};

/**
 * The model's name for display, with the id as the fallback.
 *
 * `display_name` is a RAW name rather than a display decision (the backend's
 * `model/naming.py` owns whether it is safe to show), and `""` means metadata
 * resolution found none — which is different from "no name exists" and is why
 * this falls back rather than treating the field as authoritative.
 */
export function modelIdentity(
	model: CanonicalModel | null | undefined,
): ModelIdentity | null {
	if (!model || typeof model.model_id !== "string" || !model.model_id)
		return null;
	const provider = typeof model.provider === "string" ? model.provider : "";
	const display =
		typeof model.display_name === "string" ? model.display_name.trim() : "";
	return {
		name: display || model.model_id,
		selector: provider ? `${provider}/${model.model_id}` : model.model_id,
	};
}

export type EffortState = {
	/** The word the chip prints. */
	label: string;
	/**
	 * Whether clicking should open `/effort`.
	 *
	 * False when the model has no ladder to pick from. The chip then renders as
	 * a plain label rather than a button: a control that opens a picker with
	 * nothing in it is a dead control, and the branding contract's answer to a
	 * control that cannot succeed is not to render one (see the composer's
	 * read-only working-directory chip for the same rule).
	 */
	adjustable: boolean;
	/** Why the level reads the way it does, for the tooltip. */
	detail: string;
};

/**
 * `_effort_label`, plus the older-backend degradation the TUI never needs.
 *
 * The TUI reads a live `ModelSpec` object and can rely on every field being
 * present. This reads a JSON dump from an owner that may predate
 * `reasoning_efforts` / `reasoning_default_effort` entirely, so `undefined` is
 * a fourth state the Python has no equivalent for: the ladder is not empty,
 * it is UNKNOWN. An unknown ladder cannot justify the word `auto` (which
 * asserts a ladder exists), so the fallback is the model's default level when
 * the owner sent one and nothing at all when it did not — the same rule the
 * rest of this strip follows, that a missing field degrades to an honest
 * silence rather than to a guess.
 */
export function effortState(
	model: CanonicalModel | null | undefined,
): EffortState | null {
	if (!model) return null;
	const explicit =
		typeof model.reasoning_effort === "string"
			? model.reasoning_effort.trim().toLowerCase()
			: "";
	const ladder = Array.isArray(model.reasoning_efforts)
		? model.reasoning_efforts.filter((rung) => typeof rung === "string")
		: null;
	const fallbackDefault =
		typeof model.reasoning_default_effort === "string"
			? model.reasoning_default_effort.trim().toLowerCase()
			: "";

	if (explicit)
		return {
			label: explicit,
			// An explicit level came from somewhere, so a ladder exists even when
			// this dump does not carry one: the owner's own `/effort` is the
			// authority on what else it could be set to.
			adjustable: ladder === null || ladder.length > 0,
			detail:
				ladder && ladder.length > 0
					? `Reasoning effort. This model offers ${ladder.join(", ")}.`
					: "Reasoning effort for this session.",
		};

	if (ladder && ladder.length > 0)
		return {
			// The same word `/effort auto` uses for this state, so the strip and
			// the command share one vocabulary. It used to read `reasoning` in the
			// TUI, which is a category noun in a value slot and looked like a
			// sixth level.
			label: "auto",
			adjustable: true,
			detail: `No level is set, so this model runs at its own default${
				fallbackDefault ? ` (${fallbackDefault})` : ""
			}. It offers ${ladder.join(", ")}.`,
		};

	// Ladder present and EMPTY: a reasoning model with no rungs to choose from.
	if (ladder && model.reasoning)
		return {
			label: "reasoning",
			adjustable: false,
			detail:
				"This model reasons, but exposes no effort levels to choose between.",
		};

	// Ladder UNKNOWN (an owner that predates the field). The default level is
	// the only honest thing left to show, and it is not adjustable from here
	// because nothing on this wire says what the rungs are.
	if (ladder === null && fallbackDefault)
		return {
			label: fallbackDefault,
			adjustable: false,
			detail:
				"The level this model runs at by default. This backend does not report which other levels it accepts.",
		};

	// Non-reasoning, or an old backend with nothing to say. Rendering nothing
	// is what makes the chip's presence informative.
	return null;
}
