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
/**
 * One catalogue row, as the backend publishes it.
 *
 * `label` is the ONLY field read here, and it is not a raw listing name: the
 * provider controller computes it as `model_label(provider, model_id,
 * info.name).full` (`local_operator/providers/controller.py:1403,1437,1454,
 * 1525,1643`), which is the same curated-naming pass the TUI band's
 * `format_model_label` runs. Reading it is therefore not a second naming
 * implementation - it is the backend's answer, already computed.
 */
type CatalogueRow = {
	provider?: unknown;
	model_id?: unknown;
	label?: unknown;
};

/**
 * The catalogue's curated label for a selector, or `""`.
 *
 * Matched on provider AND model_id rather than on a joined string, because an
 * aggregator's model_id contains slashes of its own (`openrouter` +
 * `openai/gpt-5`) and splitting a joined selector back apart cannot tell the
 * provider's slash from the vendor's.
 */
function catalogueLabel(
	catalogue: readonly CatalogueRow[] | null | undefined,
	provider: string,
	modelId: string,
): string {
	if (!Array.isArray(catalogue)) return "";
	for (const row of catalogue) {
		if (
			typeof row?.label === "string" &&
			row.provider === provider &&
			row.model_id === modelId
		)
			return row.label.trim();
	}
	return "";
}

/**
 * The model's human name and its full selector.
 *
 * ## Where the name comes from, and why it is not `display_name` alone
 *
 * The band does not print `display_name || model_id`. It runs the selector
 * through `format_model_label` (`status_line.py:814`), which supplies a CURATED
 * name precisely when metadata resolution gave none - so the TUI shows
 * `Claude Opus 5` where a naive fallback shows `claude-opus-5`, and the app's
 * own `/model` picker (which this chip opens) lists the curated name too. A
 * chip disagreeing with the picker one click behind it is the defect this
 * resolves (round 1, Q2/U1).
 *
 * The order below is therefore: the spec's own `display_name`, then the
 * catalogue row's `label`, then the raw id. The middle step is what makes a
 * cold snapshot - which carries a selector and an EMPTY `display_name` - still
 * name the model, because `model_catalogue` is on the same wire and is already
 * populated at that point.
 *
 * ## The residual difference from `model_label_forms`, stated
 *
 * `label` is the `full` form. The band renders the `compact` form
 * (`status_line.py:1686`, `short=True`), which drops a qualifier when doing so
 * still names one model and falls back to the bare id when the curated name is
 * WIDER than the id it replaces - a width trade that exists because the band
 * competes for cells on one terminal row. This strip wraps and truncates with
 * an ellipsis instead, so it has no such budget, and the `full` form is the
 * more informative of the two. Both forms come from the same refusal rules, so
 * the strip can never print a curated name the band would have rejected as
 * ambiguous or borrowed; it can print a longer one. That is the whole residual.
 */
export function modelIdentity(
	model: CanonicalModel | null | undefined,
	catalogue?: readonly CatalogueRow[] | null,
): ModelIdentity | null {
	if (!model || typeof model.model_id !== "string" || !model.model_id)
		return null;
	const provider = typeof model.provider === "string" ? model.provider : "";
	const display =
		typeof model.display_name === "string" ? model.display_name.trim() : "";
	const curated =
		display || catalogueLabel(catalogue, provider, model.model_id);
	const selector = provider ? `${provider}/${model.model_id}` : model.model_id;
	return {
		// A curated name that is just the selector again (what `model_label`
		// returns when it refuses to name a reseller's route) is not a name, so
		// the id is the better short form in that case.
		name: curated && curated !== selector ? curated : model.model_id,
		selector,
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
	/*
	 * The spec is a real dump in which every metadata field is simultaneously
	 * empty - which is a cold snapshot, not a model.
	 *
	 * The test is PRESENT-AND-EMPTY, never absent. `ModelSpec.model_dump()`
	 * emits every field, so a spec that came off the wire always carries
	 * `display_name` as a string and `reasoning_efforts` as an array: the key
	 * being missing entirely means an owner that predates the field, which is a
	 * different case with a different honest answer below. This is the same
	 * absent-vs-empty distinction this function already draws for the ladder,
	 * applied to the rest of the metadata.
	 *
	 * A genuine non-reasoning model never matches, because it still has a
	 * `display_name`.
	 */
	const metadataAbsent =
		// A session that has not chosen a model at all reports an EMPTY selector,
		// and has no effort to be unknown about - it is silent, not amnesiac.
		// Verified against the real cold-session capture in
		// `scripts/fixtures/session-status-capture.json`.
		typeof model.model_id === "string" &&
		model.model_id !== "" &&
		!explicit &&
		!fallbackDefault &&
		!model.reasoning &&
		Array.isArray(model.reasoning_efforts) &&
		model.reasoning_efforts.length === 0 &&
		typeof model.display_name === "string" &&
		model.display_name.trim() === "";

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

	/*
	 * Ladder present and EMPTY, on a spec that carries no metadata at all.
	 *
	 * A COLD SNAPSHOT is the case: `GET /sessions/{id}` answers with a selector
	 * and nothing else - `display_name: ""`, `reasoning: false`,
	 * `reasoning_efforts: []` - for a model that in fact has a full ladder. Round
	 * 1 shipped that as "no ladder", so after every reload the effort chip
	 * vanished until the next turn ran (U1). Rendering nothing is a claim, and
	 * there it was the false one - the same argument this file already makes
	 * about refusing to spell an unknown ladder `auto`.
	 *
	 * `metadataAbsent` is how the two are told apart: a genuine no-ladder model
	 * arrives through `refresh_from_session` with a real `display_name`, so an
	 * empty ladder NEXT TO an empty name is a snapshot that has not been told
	 * rather than a model with nothing to tell.
	 */
	if (metadataAbsent)
		return {
			label: "unknown",
			adjustable: false,
			detail:
				"This session has not reported its reasoning effort yet. It appears after the next turn, or run /effort to see the levels now.",
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

/**
 * Reconcile the chip's offer with what `/effort` will actually accept.
 *
 * ## Why this exists
 *
 * The strip reads `reasoning_efforts` off the canonical stream; `EffortPicker`
 * reads `commands.entities?command=effort`. Round 1 found the two disagreeing
 * for one model seconds apart: the stream said
 * `["minimal","low","medium","high"]` while the entities call returned `[]`, so
 * the chip advertised a four-rung ladder and the picker it opened answered
 * "this model has no adjustable effort. Pick a reasoning model with /model
 * first" (U3). A control that offers what the thing behind it refuses is worse
 * than no control.
 *
 * ## Which source wins, and why
 *
 * **The picker's.** Not because it is more likely to be right in the abstract,
 * but because it is the one that ACTS: `/effort <value>` is validated against
 * the same entities list the picker renders, so a rung absent from it cannot be
 * set no matter what the stream says. Offering it would be offering a control
 * that fails. The stream's ladder stays the source for the chip's TEXT - it is
 * present on the first paint, where the entities query has not resolved yet -
 * and only adjustability defers.
 *
 * ## Pending is not empty
 *
 * `entities === undefined` means "not asked yet", and the chip keeps its own
 * reading until an answer arrives. Treating a pending query as an empty ladder
 * would make the chip flicker from adjustable to inert on every mount, which is
 * the same "absence is a claim" mistake in a smaller frame.
 */
export function reconcileEffort(
	state: EffortState | null,
	entities: readonly unknown[] | undefined,
): EffortState | null {
	if (!state) return null;
	if (entities === undefined) return state;
	if (entities.length > 0) return state;
	// The owner will refuse every value, so the chip must stop offering to set
	// one. It still reports the level in force, which remains true.
	return {
		...state,
		adjustable: false,
		detail:
			"This model runs at a fixed reasoning effort; no other level can be set for it.",
	};
}
