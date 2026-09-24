/**
 * Default Model Step Component
 *
 * Step 2 of 3: the model new chats use. It CONFIRMS rather than asks (design
 * audit § 5): a sign-in on a current backend has already written the default
 * (`defaults_applied`), so the step shows that choice with a "Change". On an
 * older backend, or when several providers are connected, it preselects the
 * connected provider's backend suggestion and Continue writes it.
 *
 * The data source is the census plus the config (`chooseDefaultModel`), never
 * the legacy `/v1/credentials` key list: OAuth sign-ins are not in that list,
 * which is how this step came to say "No providers with credentials yet" to a
 * user who had just signed in (design D5, UX U2).
 */

import {
	type DefaultModelChoice,
	chooseDefaultModel,
} from "@features/providers/default-model-choice";
import {
	brandOf,
	modelDisplayName,
} from "@features/providers/provider-catalog";
import { useDefaultModel } from "@features/providers/use-provider-status";
import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import { Alert, Button } from "@shared/components/ui";
import { useModelsStore } from "@shared/store/models-store";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import type { FC } from "react";
import { useEffect, useState } from "react";

/**
 * The step's content, as a pure function of the choice, so a story (and a
 * test) can render every answer without a backend.
 */
export const DefaultModelSummary: FC<{
	choice: DefaultModelChoice;
	onChange: () => void;
}> = ({ choice, onChange }) => {
	if (choice.kind === "none") {
		return (
			<Alert variant="neutral">
				No provider is connected yet. Go back to connect one, or skip setup and
				connect one later from the chat.
			</Alert>
		);
	}
	if (choice.kind === "choose") {
		return (
			<p className="text-body-sm text-ink-muted">
				{brandOf(choice.provider)} is connected. Pick the model new chats should
				use.
			</p>
		);
	}
	const name =
		choice.kind === "applied"
			? (modelDisplayName(choice.provider, choice.model) ??
				`${choice.provider ? brandOf(choice.provider) : choice.hosting}'s default model`)
			: choice.model.name;
	const brand =
		choice.kind === "applied"
			? choice.provider
				? brandOf(choice.provider)
				: choice.hosting
			: brandOf(choice.provider);
	return (
		<div className="flex flex-col gap-1" data-default-model={choice.kind}>
			<p className="text-heading text-ink">{name}</p>
			<p className="text-ink-dim text-meta">
				{brand} ·{" "}
				{choice.kind === "applied"
					? "your default"
					: "suggested for your account"}
			</p>
			<div className="pt-2">
				<Button variant="secondary" size="sm" onClick={onChange}>
					Change
				</Button>
			</div>
		</div>
	);
};

type DefaultModelStepProps = {
	/**
	 * Registers the action Continue must run first, so a PROPOSED default is
	 * written when the user accepts it rather than the moment the step renders
	 * (a render that writes config is a surprise a Back press cannot undo).
	 */
	onBeforeContinue?: (run: (() => Promise<void>) | null) => void;
	/**
	 * Reports what the step still needs before Continue can mean anything, so the
	 * footer can say it and disable the button. Null when the step is ready: a
	 * step the user can walk past with nothing chosen lands them in a chat that
	 * cannot run (QA round 1 Q3, UX U1).
	 */
	onBlockReason?: (reason: string | null) => void;
};

export const DefaultModelStep: FC<DefaultModelStepProps> = ({
	onBeforeContinue,
	onBlockReason,
}) => {
	const providers = useDesktopProviders(true);
	const config = useDefaultModel();
	const updateConfig = useUpdateConfig();
	const [editing, setEditing] = useState(false);

	const choice =
		providers.isLoading || config.isLoading
			? null
			: chooseDefaultModel(providers.data ?? [], config);
	/*
	 * The provider this step SHOWS. On a backend that applies no defaults on
	 * sign-in -- every released one -- nothing is configured yet, and the provider
	 * a `choose`/`proposed` choice names is the one the user just connected.
	 * Displaying it without writing it is what let setup finish with an empty
	 * `hosting` and a chat that could not run, and it is why the model field below
	 * said "Select a hosting provider first" under a filled one (code round 1 M2,
	 * UX U1, QA Q3).
	 */
	const shownProvider =
		config.hosting ??
		(choice && (choice.kind === "choose" || choice.kind === "proposed")
			? choice.provider.id
			: "");
	const chosenModel = config.model ?? "";
	const suggestedModel = choice?.kind === "proposed" ? choice.model.id : "";
	const modelToWrite = chosenModel || suggestedModel;
	/*
	 * Whether the step still owes the user a model, and whether this Local
	 * Operator can even list one for the provider: a released backend that
	 * publishes no catalogue for OpenRouter has no rows to offer, and a step that
	 * waited for a pick that cannot happen would be a dead end rather than a
	 * guard.
	 */
	const shownRow =
		(providers.data ?? []).find((row) => row.id === shownProvider) ?? null;
	const modelsReady = useModelsStore((state) => state.isInitialized);
	const models = useModelsStore((state) => state.models);
	const catalogueHasModels =
		modelsReady && models.some((model) => model.provider === shownProvider);
	const needsModel =
		!modelToWrite &&
		(choice?.kind === "choose" ||
			(choice?.kind === "applied" && !choice.model));

	// Registered from an effect, never during render: the parent holds it in a
	// ref and runs it when Continue is pressed, so what the step SHOWS is what
	// Continue WRITES.
	useEffect(() => {
		onBeforeContinue?.(
			shownProvider
				? async () => {
						await updateConfig.mutateAsync({
							hosting: shownProvider,
							...(modelToWrite ? { model_name: modelToWrite } : {}),
						});
					}
				: null,
		);
		return () => onBeforeContinue?.(null);
	}, [onBeforeContinue, shownProvider, modelToWrite, updateConfig.mutateAsync]);

	useEffect(() => {
		if (!onBlockReason) return undefined;
		onBlockReason(
			needsModel && catalogueHasModels ? "Pick a model to continue." : null,
		);
		return () => onBlockReason(null);
	}, [onBlockReason, needsModel, catalogueHasModels]);

	if (choice === null) {
		return (
			<div className="flex items-center justify-center gap-3 py-8">
				<Spinner size="sm" />
				<p className="text-body-sm text-ink-muted">Loading your models</p>
			</div>
		);
	}

	const editor = (
		<div className="flex flex-col gap-4">
			<HostingSelect
				value={shownProvider}
				onSave={async (value) => {
					await updateConfig.mutateAsync({ hosting: value });
				}}
				filterByCredentials={true}
				allowCustom={false}
				allowDefault={false}
				emptyHelperText="No providers are connected yet. Go back a step to connect one."
			/>
			<ModelSelect
				value={chosenModel}
				/*
				 * The provider being SHOWN, not the one that happens to be saved:
				 * on a released backend nothing is saved yet, and an empty id is
				 * what made the picker say "Select a hosting provider first"
				 * directly under a filled provider field (code round 1 M2).
				 */
				hostingId={shownProvider}
				onSave={async (value) => {
					await updateConfig.mutateAsync({ model_name: value });
				}}
				allowCustom={true}
				allowDefault={false}
			/>
		</div>
	);

	return (
		<div className="flex flex-col gap-5">
			<p className="text-body text-ink-muted">
				New chats use this model. Every agent can pick a different one later.
			</p>
			{needsModel && !catalogueHasModels ? (
				<p className="text-ink-dim text-meta">
					Your Local Operator can't list{" "}
					{shownRow ? brandOf(shownRow) : "this provider's"} models
					yet. Finish setup and pick one in Settings once it can.
				</p>
			) : null}
			{editing || choice.kind === "choose" ? (
				editor
			) : (
				<DefaultModelSummary
					choice={choice}
					onChange={() => setEditing(true)}
				/>
			)}
		</div>
	);
};
