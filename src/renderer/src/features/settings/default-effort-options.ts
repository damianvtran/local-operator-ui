import { effortDisplay } from "@features/chat/session-status/session-model";
import { t } from "@shared/i18n";
/**
 * The Default effort row's rules, as pure functions.
 *
 * WHY THIS MODULE EXISTS. The row offers exactly the levels the SELECTED model
 * accepts, and every one of its answers is a decision someone can get wrong:
 * which row is the unset one, which stored value the control may show, when a
 * stored level that the new model does not accept may be rewritten, and what
 * the row says while the answer is still out. `scripts/default-effort-options.test.mjs`
 * asserts all of them over hand-built ladders, so a regression is a failing
 * test rather than a list that quietly came back empty or a silent write.
 *
 * ## The ladder is the backend's, never a local map
 *
 * There is deliberately no `MODEL_EFFORT_LEVELS` table here. The composer's
 * effort picker reads `reasoning_efforts` off the model the backend resolved
 * (`POST /v1/desktop/sessions/preview` for a draft pane), and Settings reuses
 * that same reading through `effortLadder` in
 * `features/chat/session-status/session-model.ts`. The model CATALOGUE does not
 * carry the field at all (`local_operator/server/routes/desktop_catalogues.py`),
 * so a second source would be an invention.
 *
 * ## Why the unset row exists, and why an unset value is never turned into a level
 *
 * `model_effort` is a settings-registry key whose empty string means "no
 * opinion": new conversations then use whatever level the model itself
 * resolves. Showing the resolved level as a chosen one — or writing it on
 * mount — would pin a level the user never chose, and would keep pinning it
 * after the model's own default changed. The row is named "Model default" and
 * its description states the level the preview currently reports, which is
 * what the reader needs to understand the choice without the app making it.
 *
 * ## Why an off-ladder stored value is CLAMPED rather than merely shown
 *
 * Switching the Model row can leave a stored level the new model does not
 * accept (stored `xhigh`, new ladder low/medium/high). The backend clamps
 * `model_effort` into the ladder at birth anyway (`resolve_effort_in`,
 * `local_operator/model/effort.py`), so leaving the invalid value stored means
 * the control and the first turn could disagree. Clamping writes the level the
 * BACKEND resolves for that model when the request carries no
 * `reasoning_effort` — the same function, asked rather than re-implemented —
 * and writes the empty string when that resolution names no level. The
 * consequence, accepted here and stated in the PR: returning to the old model
 * does not restore the old level.
 *
 * The write is gated shut in every state where the answer is not known: a
 * failed or unresolved preview, a ladder that is not an array, a value already
 * in the ladder, and an empty stored value all decide NO WRITE. That is what
 * keeps this from being a write loop or a guess.
 */

/** One row of the Default effort list. `id` is what a pick stores. */
export type DefaultEffortOption = {
	/** The `model_effort` value: `""` for the unset row, else a ladder rung. */
	id: string;
	/** The label shown for the row. */
	name: string;
	/** A second line under the label, when the row has something to add. */
	description?: string;
};

/**
 * The rows the control offers: the unset member first, then the ladder in the
 * backend's own ascending order.
 *
 * The unset row's description names the level the model currently resolves to
 * only when the backend reported one. A model whose spec names no level gets
 * no sentence rather than a synthesised "Auto", which is the same rule
 * `effortLevel` states: a level slot holds a level, never a state word.
 */
export function defaultEffortOptions(input: {
	ladder: readonly string[];
	/** The level the backend resolves with no rung chosen, or null. */
	resolvedLevel: string | null;
}): DefaultEffortOption[] {
	const modelDefault: DefaultEffortOption = {
		id: "",
		name: t("ui.settings.model.default_effort.model_default"),
	};
	if (input.resolvedLevel) {
		modelDefault.description = t(
			"ui.settings.model.default_effort.model_default_resolves",
			{ level: effortDisplay(input.resolvedLevel) },
		);
	}
	/*
	 * Labels come from `effortDisplay`, the same function the composer's effort
	 * picker and the session chip print through. A local title-case map would be
	 * a second naming table for one vocabulary, which is the drift that function
	 * exists to prevent.
	 */
	return [
		modelDefault,
		...input.ladder.map((rung) => ({
			id: rung,
			name: effortDisplay(rung),
		})),
	];
}

/**
 * Which row the control shows as chosen.
 *
 * A stored value that the current ladder does not contain selects the unset
 * row: offering it as a level the model accepts would be a lie, and the clamp
 * decision below is what replaces it in the registry once the preview answers.
 * Before that answer the row reads "Model default", which is honest about the
 * fact that the stored value is not in force.
 */
export function defaultEffortSelectedId(
	stored: string,
	ladder: readonly string[],
): string {
	const value = stored.trim().toLowerCase();
	return value !== "" && ladder.some((rung) => rung.toLowerCase() === value)
		? (ladder.find((rung) => rung.toLowerCase() === value) ?? "")
		: "";
}

/**
 * What a model switch should write to `model_effort`, or null for no write.
 *
 * `resolved` is the caller's "the preview answered for THIS model and its spec
 * is not unresolved" flag: false while the read is loading, failed, stale from
 * a previous model, or reporting an unresolved spec. `ladder` is null when the
 * preview's `reasoning_efforts` was not an array — never treated as an empty
 * ladder, because "no metadata" and "no rungs" are different facts.
 *
 * Returns:
 *   - null when there is nothing to do (unresolved read, empty stored value,
 *     value already in the ladder, or the clamp would equal the stored value);
 *   - `""` when the stored value is off this ladder and the backend resolves
 *     no level for the model;
 *   - the resolved level when the stored value is off this ladder and the
 *     backend names one.
 */
export function defaultEffortClampWrite(input: {
	stored: string;
	ladder: readonly string[] | null;
	resolvedLevel: string | null;
	resolved: boolean;
}): string | null {
	if (!input.resolved || input.ladder === null) return null;
	const stored = input.stored.trim().toLowerCase();
	if (stored === "") return null;
	if (input.ladder.some((rung) => rung.toLowerCase() === stored)) return null;
	const target = (input.resolvedLevel ?? "").trim().toLowerCase();
	return target === stored ? null : target;
}

/** Every state the row can be in. `unsupported` means "render nothing". */
export type DefaultEffortStateKind =
	| "unsupported"
	| "no-home"
	| "no-model"
	| "settings-loading"
	| "settings-error"
	| "loading"
	| "error"
	| "unresolved"
	| "empty"
	| "one-level"
	| "ready";

export type DefaultEffortState = {
	kind: DefaultEffortStateKind;
	/** The rows to hand the control. `[unset]` in states with nothing to offer. */
	options: DefaultEffortOption[];
	/** The row the control shows as chosen. */
	selectedId: string;
	/** Whether the control accepts a pick. */
	disabled: boolean;
	/** The line under the control, always in the app's one helper register. */
	helper: string;
};

/**
 * The state machine of the row, from the facts its callers already hold.
 *
 * ONE function rather than a ladder of `if`s inside the component, because the
 * precedence is the rule: an unsupported backend must not wait on a home
 * directory, and a failed preview must not fall through to "no adjustable
 * effort" (the composer's round-3 rule: "not known yet" is not a capability
 * claim).
 */
export function defaultEffortState(input: {
	/** The backend advertises `draft_preview`; without it there is no source. */
	supported: boolean;
	/** `useHomeDirectory()` has answered with a path. */
	hasHome: boolean;
	/** A hosting and a model id are both configured. */
	hasModel: boolean;
	/** The `settings.list` read that holds `model_effort`. */
	settings: "loading" | "error" | "ready";
	/** The `sessions.preview` read for this model. */
	preview: "loading" | "error" | "ready";
	/** The preview's `reasoning_efforts`, or null when it is not an array. */
	ladder: readonly string[] | null;
	/** The model's spec is resolved (its own unresolved check). */
	specResolved: boolean;
	stored: string;
	resolvedLevel: string | null;
}): DefaultEffortState {
	if (!input.supported) {
		return {
			kind: "unsupported",
			options: [],
			selectedId: "",
			disabled: true,
			helper: "",
		};
	}
	if (!input.hasHome) {
		return state("no-home", t("ui.settings.model.default_effort.no_home"));
	}
	if (!input.hasModel) {
		return state("no-model", t("ui.settings.model.default_effort.no_model"));
	}
	if (input.settings === "loading") {
		return state(
			"settings-loading",
			t("ui.settings.model.default_effort.settings_loading"),
		);
	}
	if (input.settings === "error") {
		return state(
			"settings-error",
			t("ui.settings.model.default_effort.settings_error"),
		);
	}
	if (input.preview === "loading") {
		return state("loading", t("ui.settings.model.default_effort.loading"));
	}
	if (input.preview === "error") {
		return state("error", t("ui.settings.model.default_effort.error"));
	}
	/*
	 * A preview that answered without an array, or with a spec the app cannot
	 * call resolved yet, is the composer's "not known yet" state. Rendering it
	 * as "no adjustable effort" would advise the reader about a capability the
	 * read did not establish.
	 */
	if (input.ladder === null || !input.specResolved) {
		return state(
			"unresolved",
			t("ui.settings.model.default_effort.unresolved"),
		);
	}
	const ladder = input.ladder;
	if (ladder.length === 0) {
		return state("empty", t("ui.settings.model.default_effort.empty"));
	}
	if (ladder.length === 1) {
		const level = ladder[0];
		/*
		 * ONE RUNG IS NOT A CHOICE. The control renders disabled and shows the
		 * only level the model accepts, rather than offering "Model default"
		 * beside a level it cannot avoid: the two rows would be one outcome with
		 * two names.
		 */
		return {
			kind: "one-level",
			options: [{ id: level, name: effortDisplay(level) }],
			selectedId: level,
			disabled: true,
			helper: t("ui.settings.model.default_effort.one_level", {
				level: effortDisplay(level),
			}),
		};
	}
	return {
		kind: "ready",
		options: defaultEffortOptions({
			ladder,
			resolvedLevel: input.resolvedLevel,
		}),
		selectedId: defaultEffortSelectedId(input.stored, ladder),
		disabled: false,
		helper: t("ui.settings.model.default_effort.helper_ready"),
	};
}

/** The disabled, nothing-to-offer shape, so each branch above states one fact. */
function state(
	kind: DefaultEffortStateKind,
	helper: string,
): DefaultEffortState {
	return {
		kind,
		options: defaultEffortOptions({ ladder: [], resolvedLevel: null }),
		selectedId: "",
		disabled: true,
		helper,
	};
}
