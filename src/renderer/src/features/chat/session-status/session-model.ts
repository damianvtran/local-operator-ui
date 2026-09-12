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
 * Providers that RESELL models rather than serving them.
 *
 * Mirrors `AGGREGATOR_PROVIDERS` (`local_operator/providers/registry.py`), read
 * by `_resells` (`model/naming.py:234-244`). Kept as a literal rather than
 * derived from the wire because nothing on the desktop contract carries it, and
 * a three-element frozenset that has not changed is cheaper to mirror than to
 * discover. What would make this mirror wrong: a fourth aggregator shipping in
 * the registry without this list learning about it - in which case the chip
 * over-names that one provider's routes, which is the pre-round-3 behaviour
 * rather than a new failure.
 */
const AGGREGATOR_PROVIDERS = new Set(["openrouter", "radient", "radient-key"]);

/**
 * The bare tail of a selector: what the band falls back to when it will not
 * name a model. `openrouter/openai/gpt-5-mini` -> `gpt-5-mini`.
 */
function bareId(selector: string): string {
	return selector.slice(selector.lastIndexOf("/") + 1) || selector;
}

/**
 * Whether a "name" is just the id handed back.
 *
 * Mirrors `_echoes_id` (`model/naming.py:247-256`) exactly, including the
 * vendor-scoped form: an endpoint with no display metadata answers with the key
 * it was asked about, and promoting that spends the whole honesty budget to
 * render the string it started from.
 */
function echoesId(name: string, modelId: string): boolean {
	return name === modelId || name === bareId(modelId);
}

/**
 * The model's human name and its full selector.
 *
 * ## The rule, and why it is this rule
 *
 * The band does not print `display_name`. It prints
 * `format_model_label(selector, short=True, name=...)` (`status_line.py:814`,
 * called at `:1686`), which routes through `model_label` and REFUSES a name it
 * cannot vouch for, falling back to the bare id. Round 2 measured the cost of
 * missing that: for an aggregator route the chip printed `OpenAI: GPT-5 Mini`
 * where the band prints `gpt-5-mini` and the picker lists the selector -
 * 445 of 563 live catalogue rows disagreed with the picker the chip opens
 * (Q3/R8/U9).
 *
 * `display_name` is `ModelInfo.name`, which is the raw LISTING name and the
 * *input* to curation, not its output. So the refusals have to be mirrored
 * here, in the order `_unambiguous_name` applies them:
 *
 * 1. **A reseller gets no name at all** (`_resells`, `naming.py:214-219`).
 *    Every aggregator resells the same models - 398 of ~400 names are shared
 *    between the two shipped ones - so no listing name can say which route is
 *    answering, and the route is what differs in price and quota.
 * 2. **A name that echoes the id is not a name** (`_echoes_id`).
 * 3. **`Unknown` is the placeholder's identity, not a model's** - the shipped
 *    registry's own word for a listing that left the name blank.
 *
 * Otherwise the listing name stands, which is what a direct provider's row is.
 *
 * ## What is deliberately NOT mirrored, and why
 *
 * `model_label`'s two remaining steps both need the shipped registry index,
 * which this app does not have and must not guess at:
 *
 * - **Qualifier dropping** (`Claude Opus 4.5 (2025-11-01)` -> `Claude Opus
 *   4.5`) is only safe because `_names_one` re-checks the shortened form for
 *   ambiguity afterwards. Dropping blindly collapses 5 distinct model pairs in
 *   the shipped registry onto a shared string - `Claude 3.7 Sonnet` would name
 *   both `-20250219` and `-latest` - which is precisely the ambiguity the band
 *   refuses. Measured, not assumed.
 * - **The width fallback** (`_ID_MARGIN`) exists because the band competes for
 *   cells on one terminal row. This strip wraps and truncates with an ellipsis,
 *   so it has no such budget and the longer name is the more informative one.
 *
 * Both omissions make the chip print a name the band SHORTENS, never one the
 * band REFUSED. Measured against the real `format_model_label` over the shipped
 * registry plus its aggregator-routed variants: 347 of 354 rows identical, the
 * 7 differences all of that shape, and 236/236 on aggregator routes where round
 * 2 found 0/445. `scripts/session-status.test.mjs` pins the count.
 *
 * The at-the-source fix is a backend-provided safe label on the wire: the
 * naming policy lives in Python and owns the registry index, so a
 * `display_label` field beside `display_name` would let this function collapse
 * to one read. Proposed in the PR; not something the desktop can do alone.
 */
export function modelIdentity(
	model: CanonicalModel | null | undefined,
): ModelIdentity | null {
	if (!model || typeof model.model_id !== "string" || !model.model_id)
		return null;
	const provider = typeof model.provider === "string" ? model.provider : "";
	const selector = provider ? `${provider}/${model.model_id}` : model.model_id;
	const display =
		typeof model.display_name === "string" ? model.display_name.trim() : "";
	const refused =
		AGGREGATOR_PROVIDERS.has(provider) ||
		!display ||
		echoesId(display, model.model_id) ||
		display.toLowerCase() === "unknown";
	return { name: refused ? bareId(selector) : display, selector };
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
	/**
	 * Whether the LADDER itself is known, as opposed to the level in force.
	 *
	 * Distinct from `adjustable` because the two answer different questions and
	 * round 2 showed what conflating them costs: a cold owner's chip is
	 * adjustable (opening it is how the spec resolves) while its ladder is
	 * unknown, and a fixed-effort model's ladder is known to be empty while the
	 * chip is not adjustable. Only this flag may decide whether the picker's
	 * rung list has anything to add.
	 */
	knownLadder: boolean;
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
			// Known only when this dump actually carried the rungs.
			knownLadder: Boolean(ladder && ladder.length > 0),
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
			knownLadder: true,
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
			/*
			 * ADJUSTABLE, despite knowing nothing.
			 *
			 * Round 1 made this inert on the reasoning that a chip should not
			 * offer what it cannot describe. Round 2 showed the cost: this is the
			 * state every app start begins in, `/effort low` succeeds in it, and
			 * an inert chip left the picker - which resolves the spec by asking
			 * the owner - reachable only by typing the command the chip exists to
			 * replace (U8/U10).
			 *
			 * An unresolved ladder is not an absent one, so the honest control is
			 * the one that can find out. The copy says so rather than naming
			 * rungs it does not know.
			 */
			adjustable: true,
			// The whole point of this branch: the ladder is NOT known.
			knownLadder: false,
			detail:
				"This session has not reported its reasoning effort yet. It appears after the next turn, or open this to see the levels now.",
		};
	// Ladder present and EMPTY: a reasoning model with no rungs to choose from.
	if (ladder && model.reasoning)
		return {
			label: "reasoning",
			adjustable: false,
			// The spec DID carry the ladder; it is empty. That is knowledge, and
			// it is the only source entitled to make this control read-only.
			knownLadder: true,
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
			knownLadder: false,
			detail:
				"The level this model runs at by default. This backend does not report which other levels it accepts.",
		};

	// Non-reasoning, or an old backend with nothing to say. Rendering nothing
	// is what makes the chip's presence informative.
	return null;
}

/**
 * Fold the picker's live rung list into the chip's reading.
 *
 * ## What round 2 proved, and why this is not the round-1 rule inverted
 *
 * Round 1's rule was "the picker's list wins, because it is the source that
 * acts". That premise was wrong, and the evidence is in the backend:
 * `command-entities?command=effort` reads `remote.model.reasoning_efforts`
 * (`server/routes/desktop_catalogues.py:270-273`) and `/effort <rung>`
 * validates against `spec.reasoning_efforts` on the SAME owner spec
 * (`serving.py:1977-1991`). They are one field read at two times, not a policy
 * and a mirror of it. So an empty list does not mean "every value will be
 * refused" - it means the owner has not resolved its spec yet, and setting a
 * rung is itself what resolves it.
 *
 * Treating empty as a refusal made the chip inert on every cold owner - the
 * first state every user meets - while telling them "this model runs at a fixed
 * reasoning effort; no other level can be set for it" about a model with four
 * rungs, which `/effort low` then set successfully (round 2, U8). That is a
 * confident falsehood where round 1 merely had an over-offer, and it survived a
 * full turn and 25s; only a reload cleared it.
 *
 * ## The rule now
 *
 * An empty list is EVIDENCE OF NOTHING and is treated that way: the chip keeps
 * its own reading, because the stream's spec is the fresher fact and the only
 * one either side can act on. The list is consulted only when it is non-empty,
 * where it genuinely adds information the stream may lack - a rung the owner
 * accepts that this dump did not carry - and then it makes the chip adjustable
 * rather than less so.
 *
 * The read-only form is therefore reached the way it always should have been:
 * from the SPEC saying a reasoning model exposes no rungs (`effortState`), not
 * from an absence in a second source. Nothing here overwrites `detail`, which
 * is what made the honest-unknown copy unreachable (round 2, U10).
 */
export function reconcileEffort(
	state: EffortState | null,
	entities: readonly unknown[] | undefined,
): EffortState | null {
	if (!state) return null;
	if (!entities || entities.length === 0) return state;
	// Nothing to add when the spec already named the ladder: the stream is the
	// authority on the reading, and this list would only restate it.
	if (state.knownLadder) return state;
	const rungs = entities
		.map((row) =>
			typeof row === "object" && row !== null && "value" in row
				? String((row as { value: unknown }).value)
				: "",
		)
		.filter(Boolean);
	if (rungs.length === 0) return state;
	return {
		...state,
		adjustable: true,
		detail: `Reasoning effort. This model offers ${rungs.join(", ")}.`,
	};
}
