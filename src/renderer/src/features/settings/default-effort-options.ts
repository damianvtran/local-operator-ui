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
 * ## The storable vocabulary is the backend's too
 *
 * The ladder is not the set of values `model_effort` accepts: Radient's ladder
 * carries `auto` (`model/configure.py`), which is the registry's LABEL for its
 * empty choice, not a value (`settings_io.py`). The storable set therefore comes
 * from the settings row the page already reads: `settings.list` carries
 * `choices[].value` for `model_effort` (`""` plus the rungs the validator
 * accepts). A ladder rung outside that set is never offered and never written.
 * This is deliberately not a local table of level names: the backend owns both
 * vocabularies, and a second copy here would drift from either.
 *
 * ## Why the unset row exists, and why an unset value is never turned into a level
 *
 * `model_effort` is a settings-registry key whose empty string means "no
 * opinion": new conversations then use whatever level the model itself
 * resolves. Showing the resolved level as a chosen one — or writing it on
 * mount — would pin a level the user never chose, and would keep pinning it
 * after the model's own default changed. The row is named "Model default" and
 * its description states the level the model resolves to with NOTHING stored -
 * the only state in which the preview's report describes the unset row rather
 * than the stored value's own clamp (see `defaultEffortOptions`).
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
 * only when the backend reported a level this key can store. A model whose spec
 * names no level — or names only the `auto` sentinel — gets no sentence, because
 * the sentence exists to state WHICH level clearing the row runs; an "Auto" in
 * that slot would restate the absence of an opinion as if it were a level, the
 * same rule `effortLevel` states. */
export function defaultEffortOptions(input: {
	ladder: readonly string[];
	/** The level the preview reports with no rung chosen, or null. */
	resolvedLevel: string | null;
	/**
	 * The stored `model_effort`.
	 *
	 * REQUIRED, because it decides whether the resolved level describes the
	 * unset row at all: with nothing stored the preview answers the model's own
	 * default, which is exactly what `""` selects; with a value stored the
	 * preview answers THAT value clamped into this model's ladder
	 * (`resolve_effort_in` reads the configured level), which is a fact about
	 * the selected row, not about the model's default. Describing `""` with it
	 * would say "Model default runs at High" while clearing the row would run
	 * the model's seeded level instead.
	 */
	stored: string;
	/**
	 * The values `model_effort` can store, from the settings row's
	 * `choices[].value`. `""` is always one of them; a ladder rung absent from
	 * this set is a sentinel the registry cannot hold.
	 */
	storable: readonly string[];
}): DefaultEffortOption[] {
	const modelDefault: DefaultEffortOption = {
		id: "",
		name: t("ui.settings.model.default_effort.model_default"),
	};
	if (
		input.resolvedLevel &&
		input.stored.trim() === "" &&
		/*
		 * `auto` is a sentinel, not a level: "Runs at Auto" would restate the
		 * absence of an opinion in a level's slot. Only a value this key could
		 * actually store is named by the sentence.
		 */
		storableEffortValue(input.resolvedLevel, input.storable) !== null
	) {
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
	return [modelDefault, ...storableRungs(input.ladder, input.storable)];
}

/**
 * The storable spelling of one ladder value, or null when `model_effort` cannot
 * hold it.
 *
 * The match folds case because the two vocabularies are separate fields on the
 * wire and only agree by convention; the RETURNED value is the settings row's
 * own spelling, which is the one the validator was measured against.
 */
export function storableEffortValue(
	value: string,
	storable: readonly string[],
): string | null {
	const needle = value.trim().toLowerCase();
	if (needle === "") return null;
	return (
		storable.find((entry) => entry.trim().toLowerCase() === needle) ?? null
	);
}

/**
 * The ladder's rungs this key can store, in the backend's order, as rows.
 *
 * A sentinel rung (`auto`) maps to no row: the unset row already stores the
 * empty string that sentinel stands for, so adding one would give one outcome
 * two names - the same rule the single-rung state states.
 */
function storableRungs(
	ladder: readonly string[],
	storable: readonly string[],
): DefaultEffortOption[] {
	return ladder.flatMap((rung) => {
		const id = storableEffortValue(rung, storable);
		return id === null ? [] : [{ id, name: effortDisplay(rung) }];
	});
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
 *     no level for the model, OR when the resolved level is not storable
 *     (Radient's `auto` sentinel) — this key may only hold `""` or a member of
 *     `EFFORT_ORDER` (`settings_io.py`), and a write the registry rejects is
 *     not a clamp;
 *   - the resolved level (in the settings row's own spelling) otherwise.
 */
export function defaultEffortClampWrite(input: {
	stored: string;
	ladder: readonly string[] | null;
	resolvedLevel: string | null;
	resolved: boolean;
	storable: readonly string[];
}): string | null {
	if (!input.resolved || input.ladder === null) return null;
	const stored = input.stored.trim().toLowerCase();
	if (stored === "") return null;
	if (input.ladder.some((rung) => rung.toLowerCase() === stored)) return null;
	const resolved = (input.resolvedLevel ?? "").trim();
	const target =
		resolved === ""
			? ""
			: (storableEffortValue(resolved, input.storable) ?? "");
	return target.trim().toLowerCase() === stored ? null : target;
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
	/**
	 * The row the control shows as chosen, or `NO_EFFORT_SELECTION` when the
	 * stored value is not known yet (the control then shows its placeholder).
	 */
	selectedId: string;
	/** Whether the control accepts a pick. */
	disabled: boolean;
	/** The line under the control, always in the app's one helper register. */
	helper: string;
};

/**
 * The `selectedId` for a state where the stored value could NOT be read.
 *
 * Rendering the unset row as chosen would claim "Model default" for a value the
 * app does not know - exactly what the helper beside it says it could not read.
 * The control shows its placeholder instead, and matches no option because this
 * spelling is not a `model_effort` value.
 */
export const NO_EFFORT_SELECTION = "\u0000unread";

/**
 * The selection for a state whose stored value IS known but whose LADDER for the
 * current model is not (preview loading/failed/unresolved, or a known-empty
 * ladder).
 *
 * The unset row may be shown only when NOTHING is stored: `""` is exactly what
 * that row stands for, so naming it claims nothing the registry does not hold.
 * With a level stored, selecting the unset row would say "Model default" while
 * the registry holds a level - the false claim the settings read's own failure
 * avoids with `NO_EFFORT_SELECTION`. The control shows its placeholder until the
 * model's ladder answers, and the helper beside it says what is being checked.
 */
function knownStoredSelection(stored: string): string {
	return stored.trim() === "" ? "" : NO_EFFORT_SELECTION;
}

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
	/** The values `model_effort` can store, from `settings.list`'s choices. */
	storable: readonly string[];
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
		/*
		 * NO CHOSEN ROW: there is no model for a stored value to mean anything
		 * about, so the field shows its placeholder rather than naming a default
		 * of nothing. (The settings read may still be in flight here; the state
		 * does not claim to know the stored value either way.)
		 */
		return state(
			"no-model",
			t("ui.settings.model.default_effort.no_model"),
			NO_EFFORT_SELECTION,
		);
	}
	if (input.settings === "loading") {
		return state(
			"settings-loading",
			t("ui.settings.model.default_effort.settings_loading"),
			NO_EFFORT_SELECTION,
		);
	}
	if (input.settings === "error") {
		return state(
			"settings-error",
			t("ui.settings.model.default_effort.settings_error"),
			NO_EFFORT_SELECTION,
		);
	}
	if (input.preview === "loading") {
		return state(
			"loading",
			t("ui.settings.model.default_effort.loading"),
			knownStoredSelection(input.stored),
		);
	}
	if (input.preview === "error") {
		return state(
			"error",
			t("ui.settings.model.default_effort.error"),
			knownStoredSelection(input.stored),
		);
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
			knownStoredSelection(input.stored),
		);
	}
	const ladder = input.ladder;
	if (ladder.length === 0) {
		return state(
			"empty",
			t("ui.settings.model.default_effort.empty"),
			knownStoredSelection(input.stored),
		);
	}
	const rungs = storableRungs(ladder, input.storable);
	if (rungs.length === 0) {
		/*
		 * NOTHING TO CHOOSE, because every rung is outside this key's vocabulary —
		 * on a Radient model the ladder is `auto` (plus levels), and `auto` is the
		 * registry's LABEL for `""`, not a storable value. The unset row already
		 * stores that outcome, so the control names the single outcome and takes no
		 * pick rather than offering a row whose write the validator would reject.
		 *
		 * The AUTO-ONLY ladder gets its own sentence: `auto` is a delegation to the
		 * model, not an effort level, so calling it "one effort level: Auto" would
		 * put a state word in a level's slot. A real single level keeps the level
		 * sentence.
		 */
		const level = effortDisplay(ladder[0]);
		const sentinel =
			ladder.length === 1 && ladder[0].trim().toLowerCase() === "auto";
		return {
			kind: "one-level",
			options: [{ id: "", name: level }],
			selectedId: "",
			disabled: true,
			helper: sentinel
				? t("ui.settings.model.default_effort.one_level_sentinel")
				: t("ui.settings.model.default_effort.one_level", { level }),
		};
	}
	if (ladder.length === 1) {
		/*
		 * ONE RUNG IS NOT A CHOICE. The control renders disabled and shows the
		 * only level the model accepts, rather than offering "Model default"
		 * beside a level it cannot avoid: the two rows would be one outcome with
		 * two names.
		 */
		const [rung] = rungs;
		return {
			kind: "one-level",
			options: [rung],
			selectedId: rung.id,
			disabled: true,
			helper: t("ui.settings.model.default_effort.one_level", {
				level: rung.name,
			}),
		};
	}
	return {
		kind: "ready",
		options: defaultEffortOptions({
			ladder,
			resolvedLevel: input.resolvedLevel,
			stored: input.stored,
			storable: input.storable,
		}),
		selectedId: defaultEffortSelectedId(
			input.stored,
			rungs.map((rung) => rung.id),
		),
		disabled: false,
		helper: t("ui.settings.model.default_effort.helper_ready"),
	};
}

/** The disabled, nothing-to-offer shape, so each branch above states one fact. */
function state(
	kind: DefaultEffortStateKind,
	helper: string,
	selectedId = "",
): DefaultEffortState {
	return {
		kind,
		options: defaultEffortOptions({
			ladder: [],
			resolvedLevel: null,
			stored: "",
			storable: [],
		}),
		selectedId,
		disabled: true,
		helper,
	};
}
