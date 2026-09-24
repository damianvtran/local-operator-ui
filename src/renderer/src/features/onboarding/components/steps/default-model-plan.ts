/**
 * @file default-model-plan.ts
 * @description
 * What the default-model step SHOWS and WRITES, as one pure decision.
 *
 * ## Why it is a separate function
 *
 * The step's rule was only ever in the component, so the three mutants a review
 * round tried -- never write the shown provider, never report that a model is
 * still needed, and finish anyway -- all survived the whole suite (review round 2
 * R2-M3). The rule is not about React: given what is configured, what the user
 * just connected and what this Local Operator can list, there is exactly one thing
 * Continue should write and one reason it may not be pressable. Splitting it out
 * makes both halves assertable without a renderer, the same split `sign-in-flow.ts`
 * uses.
 *
 * ## The two failures it exists for
 *
 * - A released backend applies no defaults on sign-in, so `hosting` is empty while
 *   the step displays the provider the user just connected. Displaying it without
 *   WRITING it let setup finish with no hosting at all, and the first message
 *   failed with the backend's stale default (code round 1 M2, QA Q3, UX U1).
 * - A step that waited for a model pick this Local Operator cannot offer would be a
 *   dead end rather than a guard, so the block is reported only when a catalogue
 *   exists to pick from.
 */

import type { DefaultModelChoice } from "@features/providers/default-model-choice";

export type DefaultModelPlanInput = {
	/** What `chooseDefaultModel` decided, or null while either read is loading. */
	choice: DefaultModelChoice | null;
	/** `config.hosting`, as the app currently holds it. */
	hosting: string | null;
	/** `config.model`. */
	model: string | null;
	/** The providers this Local Operator can list at least one model for. */
	catalogue: { ready: boolean; providers: readonly string[] };
};

export type DefaultModelPlan = {
	/** The provider the step must DISPLAY, and the one Continue writes. */
	shownProvider: string;
	/** What Continue writes first, or null when there is nothing to write. */
	write: { hosting: string; model_name?: string } | null;
	/** Why Continue must stay disabled, or null when the step is ready. */
	block: string | null;
	/**
	 * A model is owed and this Local Operator can list none for the provider, so the
	 * step has to say that rather than wait for a pick that cannot happen.
	 */
	noCatalogue: boolean;
	/** The model the picker must SHOW, whatever the source it came from. */
	modelToWrite: string;
};

/** The reason shown under a disabled Continue on this step. */
export const PICK_A_MODEL = "Pick a model to continue.";

/**
 * The reason while the catalogue is still being fetched.
 *
 * WHY IT IS NOT THE NO-CATALOGUE SENTENCE: "your Local Operator can't list these
 * models" is a claim about the BACKEND, and it was made on a released backend that
 * was serving seven DeepSeek models at the time -- nothing had asked it yet, because
 * the list is fetched on picker mount and no picker was mounted (QA round 3 Q3-3,
 * UX round 3 U9). Waiting says what is true while we ask.
 */
export const LOADING_MODELS = "Loading the model list…";

export function planDefaultModelWrite(
	input: DefaultModelPlanInput,
): DefaultModelPlan {
	const { choice, hosting, model, catalogue } = input;
	/*
	 * The provider the step shows is the configured one when there is one, and
	 * otherwise the provider the choice names -- `choose` and `proposed` are exactly
	 * the two kinds that know which provider the user just connected.
	 */
	const shownProvider =
		hosting ??
		(choice && (choice.kind === "choose" || choice.kind === "proposed")
			? choice.provider.id
			: "");
	const chosenModel = model ?? "";
	const suggestedModel = choice?.kind === "proposed" ? choice.model.id : "";
	const modelToWrite = chosenModel || suggestedModel;
	const catalogueHasModels =
		catalogue.ready && catalogue.providers.includes(shownProvider);
	/*
	 * A model is owed when the choice is a pick (`choose`) or when the backend said
	 * it applied defaults but reported no model with them (`applied` without one).
	 */
	const needsModel =
		!modelToWrite &&
		(choice?.kind === "choose" ||
			(choice?.kind === "applied" && !choice.model));

	return {
		shownProvider,
		write: shownProvider
			? {
					hosting: shownProvider,
					...(modelToWrite ? { model_name: modelToWrite } : {}),
				}
			: null,
		block: needsModel
			? catalogueHasModels
				? PICK_A_MODEL
				: catalogue.ready
					? null
					: LOADING_MODELS
			: null,
		/*
		 * Only a READY catalogue that lists nothing for this provider can say the
		 * models are unavailable; before that the honest state is "not asked yet".
		 */
		noCatalogue: needsModel && catalogue.ready && !catalogueHasModels,
		modelToWrite,
	};
}
